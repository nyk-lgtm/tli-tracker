"""
Disk-backed item price history manager.

Fetches one-item chart history from the worker, persists it to per-item files,
and exposes stale-while-revalidate snapshots to the UI layer.
"""

import json
import math
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from PySide6.QtCore import QObject, QUrl, Signal
from PySide6.QtNetwork import QNetworkAccessManager, QNetworkReply, QNetworkRequest

from .storage import DATA_DIR, preserve_unreadable_file

PRICE_HISTORY_BASE_URL = "https://api.tli-ahdb.workers.dev/chart"
PRICE_HISTORY_CACHE_DIR = "price_history"
DEFAULT_RANGE_KEY = "7d"
RANGE_CONFIG = {
    "7d": {"label": "7D", "interval": "1h", "stale_after": timedelta(hours=1)},
    "30d": {"label": "30D", "interval": "1d", "stale_after": timedelta(hours=6)},
}
CACHE_RETENTION = timedelta(days=30)


class PriceHistoryManager(QObject):
    """Fetch and cache per-item chart history on disk."""

    history_updated = Signal(object)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._in_flight: set[str] = set()
        self._nam = QNetworkAccessManager(self)
        self._nam.finished.connect(self._on_reply)

    def _now(self) -> datetime:
        return datetime.now(timezone.utc)

    def _normalize_range_key(self, range_key: str | None) -> str:
        if range_key in RANGE_CONFIG:
            return range_key
        return DEFAULT_RANGE_KEY

    def _range_config(self, range_key: str | None) -> dict[str, Any]:
        return RANGE_CONFIG[self._normalize_range_key(range_key)]

    def _cache_key(self, item_id: str, range_key: str) -> str:
        return f"{item_id}:{self._normalize_range_key(range_key)}"

    def _cache_dir(self) -> Path:
        path = DATA_DIR / PRICE_HISTORY_CACHE_DIR
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _cache_path(self, item_id: str, range_key: str) -> Path:
        safe_item_id = re.sub(r"[^A-Za-z0-9_-]+", "_", str(item_id or ""))
        if not safe_item_id:
            safe_item_id = "unknown"
        return (
            self._cache_dir()
            / f"{safe_item_id}_{self._normalize_range_key(range_key)}.json"
        )

    def _build_url(self, item_id: str, range_key: str) -> str:
        range_config = self._range_config(range_key)
        return (
            f"{PRICE_HISTORY_BASE_URL}/{quote(str(item_id), safe='')}"
            f"?interval={range_config['interval']}"
        )

    def _parse_datetime(self, raw_value: str) -> datetime:
        normalized_value = raw_value
        if normalized_value.endswith("Z"):
            normalized_value = normalized_value[:-1] + "+00:00"
        parsed = datetime.fromisoformat(normalized_value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    def _normalize_points(self, raw_points: Any) -> list[dict[str, float]]:
        if not isinstance(raw_points, list):
            raise ValueError("price history points must be a list")

        normalized_points: list[dict[str, float]] = []
        for raw_point in raw_points:
            if not isinstance(raw_point, dict):
                continue

            raw_timestamp = raw_point.get("timestamp", raw_point.get("ts"))
            raw_value = raw_point.get("value", raw_point.get("price"))
            if raw_timestamp is None or raw_value is None:
                continue

            try:
                timestamp = int(raw_timestamp)
                value = float(raw_value)
            except (TypeError, ValueError):
                continue

            if timestamp <= 0 or not math.isfinite(value):
                continue

            normalized_points.append({"timestamp": timestamp, "value": value})

        normalized_points.sort(key=lambda point: point["timestamp"])
        if raw_points and not normalized_points:
            raise ValueError("price history points did not contain any valid entries")
        return normalized_points

    def _build_stats(self, points: list[dict[str, float]]) -> dict[str, Any]:
        if not points:
            return {
                "latest": None,
                "min": None,
                "max": None,
                "deltaPercent": None,
                "startTimestamp": None,
                "endTimestamp": None,
                "pointCount": 0,
            }

        values = [point["value"] for point in points]
        latest = values[-1]
        first = values[0]
        return {
            "latest": latest,
            "min": min(values),
            "max": max(values),
            "deltaPercent": ((latest - first) / first) * 100 if first > 0 else None,
            "startTimestamp": points[0]["timestamp"],
            "endTimestamp": points[-1]["timestamp"],
            "pointCount": len(points),
        }

    def _build_payload(
        self,
        item_id: str,
        range_key: str,
        points: list[dict[str, float]],
        fetched_at: str,
        interval: str | None = None,
    ) -> dict[str, Any]:
        normalized_range_key = self._normalize_range_key(range_key)
        return {
            "itemId": str(item_id),
            "rangeKey": normalized_range_key,
            "interval": interval
            or self._range_config(normalized_range_key)["interval"],
            "points": points,
            "stats": self._build_stats(points),
            "fetchedAt": fetched_at,
        }

    def _build_entry(
        self,
        item_id: str,
        range_key: str,
        *,
        status: str,
        stale: bool = False,
        data: dict[str, Any] | None = None,
        error_message: str = "",
    ) -> dict[str, Any]:
        return {
            "itemId": str(item_id),
            "rangeKey": self._normalize_range_key(range_key),
            "status": status,
            "stale": stale,
            "data": data,
            "errorMessage": error_message,
        }

    def _entry_from_payload(
        self, payload: dict[str, Any], *, stale: bool
    ) -> dict[str, Any]:
        status = "empty" if not payload["points"] else "ready"
        return self._build_entry(
            payload["itemId"],
            payload["rangeKey"],
            status=status,
            stale=stale,
            data=payload,
        )

    def _is_stale(self, payload: dict[str, Any], range_key: str) -> bool:
        try:
            fetched_at = self._parse_datetime(str(payload["fetchedAt"]))
        except (KeyError, TypeError, ValueError):
            return True
        return (self._now() - fetched_at) >= self._range_config(range_key)[
            "stale_after"
        ]

    def _normalize_cached_payload(
        self, raw_payload: Any, expected_item_id: str, expected_range_key: str
    ) -> dict[str, Any]:
        if not isinstance(raw_payload, dict):
            raise ValueError("price history cache must contain a JSON object")

        item_id = str(raw_payload.get("itemId", ""))
        if item_id != expected_item_id:
            raise ValueError("price history cache itemId mismatch")

        normalized_range_key = self._normalize_range_key(raw_payload.get("rangeKey"))
        if normalized_range_key != expected_range_key:
            raise ValueError("price history cache rangeKey mismatch")

        interval = str(raw_payload.get("interval", ""))
        if interval != self._range_config(expected_range_key)["interval"]:
            raise ValueError("price history cache interval mismatch")

        fetched_at = str(raw_payload.get("fetchedAt", ""))
        self._parse_datetime(fetched_at)

        points = self._normalize_points(raw_payload.get("points", []))
        return self._build_payload(
            item_id, expected_range_key, points, fetched_at, interval
        )

    def _load_cached_payload(
        self, item_id: str, range_key: str
    ) -> dict[str, Any] | None:
        cache_path = self._cache_path(item_id, range_key)
        if not cache_path.exists():
            return None

        try:
            with open(cache_path, "r", encoding="utf-8") as cache_file:
                raw_payload = json.load(cache_file)
            return self._normalize_cached_payload(
                raw_payload, str(item_id), self._normalize_range_key(range_key)
            )
        except (json.JSONDecodeError, PermissionError, OSError, ValueError) as error:
            print(f"[PriceHistoryManager] Failed to load {cache_path.name}: {error}")
            return None

    def _save_payload(self, payload: dict[str, Any]) -> bool:
        cache_path = self._cache_path(payload["itemId"], payload["rangeKey"])

        if cache_path.exists():
            try:
                with open(cache_path, "r", encoding="utf-8") as cache_file:
                    raw_payload = json.load(cache_file)
                self._normalize_cached_payload(
                    raw_payload, payload["itemId"], payload["rangeKey"]
                )
            except (json.JSONDecodeError, PermissionError, OSError, ValueError):
                if preserve_unreadable_file(cache_path) is None:
                    return False

        try:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            with open(cache_path, "w", encoding="utf-8") as cache_file:
                json.dump(payload, cache_file, indent=2, ensure_ascii=False)
            self._prune_cache_dir()
            return True
        except OSError as error:
            print(f"[PriceHistoryManager] Failed to save {cache_path.name}: {error}")
            return False

    def _prune_cache_dir(self) -> None:
        cutoff = self._now() - CACHE_RETENTION
        for cache_path in self._cache_dir().glob("*.json"):
            try:
                modified_at = datetime.fromtimestamp(
                    cache_path.stat().st_mtime, timezone.utc
                )
                if modified_at < cutoff:
                    cache_path.unlink(missing_ok=True)
            except OSError as error:
                print(
                    f"[PriceHistoryManager] Failed to prune {cache_path.name}: {error}"
                )

    def _normalize_remote_payload(
        self, raw_payload: Any, item_id: str, range_key: str
    ) -> dict[str, Any]:
        if not isinstance(raw_payload, dict):
            raise ValueError("worker price history response must be a JSON object")

        points = self._normalize_points(raw_payload.get("points", []))
        interval = raw_payload.get("interval")
        if not isinstance(interval, str) or not interval:
            interval = self._range_config(range_key)["interval"]

        return self._build_payload(
            str(item_id),
            range_key,
            points,
            self._now().isoformat(),
            interval,
        )

    def get_price_history(self, item_id: str, range_key: str) -> dict[str, Any]:
        normalized_item_id = str(item_id or "")
        normalized_range_key = self._normalize_range_key(range_key)

        if not normalized_item_id:
            return self._build_entry(
                normalized_item_id,
                normalized_range_key,
                status="error",
                error_message="This item does not have a history id.",
            )

        payload = self._load_cached_payload(normalized_item_id, normalized_range_key)
        if payload is not None:
            return self._entry_from_payload(
                payload,
                stale=self._is_stale(payload, normalized_range_key),
            )

        if self._cache_key(normalized_item_id, normalized_range_key) in self._in_flight:
            return self._build_entry(
                normalized_item_id,
                normalized_range_key,
                status="loading",
            )

        return self._build_entry(
            normalized_item_id,
            normalized_range_key,
            status="missing",
        )

    def request_price_history(self, item_id: str, range_key: str) -> dict[str, Any]:
        normalized_item_id = str(item_id or "")
        normalized_range_key = self._normalize_range_key(range_key)

        if not normalized_item_id:
            return {
                "status": "error",
                "itemId": normalized_item_id,
                "rangeKey": normalized_range_key,
                "message": "This item does not have a history id.",
            }

        key = self._cache_key(normalized_item_id, normalized_range_key)
        if key in self._in_flight:
            return {
                "status": "in_flight",
                "itemId": normalized_item_id,
                "rangeKey": normalized_range_key,
            }

        snapshot = self.get_price_history(normalized_item_id, normalized_range_key)
        if snapshot["status"] in {"ready", "empty"} and not snapshot["stale"]:
            return {
                "status": "fresh",
                "itemId": normalized_item_id,
                "rangeKey": normalized_range_key,
            }

        request = QNetworkRequest(
            QUrl(self._build_url(normalized_item_id, normalized_range_key))
        )
        request.setRawHeader(b"Accept", b"application/json")
        reply = self._nam.get(request)
        reply.setProperty("itemId", normalized_item_id)
        reply.setProperty("rangeKey", normalized_range_key)
        reply.setProperty("hadCache", snapshot["status"] in {"ready", "empty"})
        self._in_flight.add(key)

        return {
            "status": "queued",
            "itemId": normalized_item_id,
            "rangeKey": normalized_range_key,
        }

    def _on_reply(self, reply: QNetworkReply) -> None:
        item_id = str(reply.property("itemId") or "")
        range_key = self._normalize_range_key(reply.property("rangeKey"))
        had_cache = bool(reply.property("hadCache"))
        self._in_flight.discard(self._cache_key(item_id, range_key))

        try:
            if reply.error() != QNetworkReply.NetworkError.NoError:
                failure_message = (
                    "[PriceHistoryManager] Fetch failed for "
                    f"{item_id} ({range_key}): {reply.errorString()}"
                )
                print(failure_message)
                if not had_cache:
                    self.history_updated.emit(
                        self._build_entry(
                            item_id,
                            range_key,
                            status="error",
                            error_message="Price history unavailable right now.",
                        )
                    )
                return

            raw_payload = json.loads(bytes(reply.readAll().data()))
            payload = self._normalize_remote_payload(raw_payload, item_id, range_key)
            self._save_payload(payload)
            self.history_updated.emit(self._entry_from_payload(payload, stale=False))
        except (json.JSONDecodeError, TypeError, ValueError) as error:
            parse_failure_message = (
                "[PriceHistoryManager] Failed to parse history for "
                f"{item_id} ({range_key}): {error}"
            )
            print(parse_failure_message)
            if not had_cache:
                self.history_updated.emit(
                    self._build_entry(
                        item_id,
                        range_key,
                        status="error",
                        error_message="Failed to load price history.",
                    )
                )
        finally:
            reply.deleteLater()
