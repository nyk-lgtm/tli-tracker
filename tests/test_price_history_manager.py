import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock

from PySide6.QtNetwork import QNetworkReply

from app.price_history_manager import PriceHistoryManager


class _FakeReadBuffer:
    def __init__(self, payload: bytes):
        self._payload = payload

    def data(self) -> bytes:
        return self._payload


class FakeReply:
    def __init__(
        self,
        *,
        error=QNetworkReply.NetworkError.NoError,
        payload: bytes = b"",
        error_string: str = "network error",
        properties: dict[str, object] | None = None,
    ):
        self._error = error
        self._payload = payload
        self._error_string = error_string
        self._properties = dict(properties or {})
        self.deleted = False

    def error(self):
        return self._error

    def errorString(self) -> str:
        return self._error_string

    def readAll(self) -> _FakeReadBuffer:
        return _FakeReadBuffer(self._payload)

    def property(self, name: str):
        return self._properties.get(name)

    def setProperty(self, name: str, value) -> None:
        self._properties[name] = value

    def deleteLater(self) -> None:
        self.deleted = True


def make_manager(now: datetime | None = None) -> PriceHistoryManager:
    manager = PriceHistoryManager.__new__(PriceHistoryManager)
    manager._in_flight = set()
    manager._nam = MagicMock()
    manager.history_updated = MagicMock()
    fixed_now = now or datetime(2026, 4, 15, 12, 0, tzinfo=timezone.utc)
    manager._now = lambda: fixed_now
    return manager


def build_payload(
    manager: PriceHistoryManager,
    *,
    item_id: str = "5028",
    range_key: str = "7d",
    fetched_at: str | None = None,
    points: list[dict[str, float]] | None = None,
) -> dict:
    if fetched_at is None:
        fetched_at = manager._now().isoformat()
    if points is None:
        points = [
            {"timestamp": 1775865600000, "value": 0.0379},
            {"timestamp": 1775952000000, "value": 0.0412},
        ]
    return manager._build_payload(item_id, range_key, points, fetched_at)


def test_get_price_history_returns_missing_when_cache_absent() -> None:
    manager = make_manager()

    snapshot = manager.get_price_history("5028", "7d")

    assert snapshot["status"] == "missing"
    assert snapshot["stale"] is False
    assert snapshot["data"] is None


def test_request_price_history_dedupes_missing_cache_requests() -> None:
    manager = make_manager()
    reply = FakeReply()
    manager._nam.get.return_value = reply

    first = manager.request_price_history("5028", "7d")
    second = manager.request_price_history("5028", "7d")
    snapshot = manager.get_price_history("5028", "7d")

    assert first["status"] == "queued"
    assert second["status"] == "in_flight"
    assert snapshot["status"] == "loading"
    manager._nam.get.assert_called_once()
    assert reply.property("itemId") == "5028"
    assert reply.property("rangeKey") == "7d"
    assert reply.property("hadCache") is False


def test_request_price_history_returns_fresh_when_cache_is_recent() -> None:
    manager = make_manager()
    payload = build_payload(manager)
    manager._save_payload(payload)

    snapshot = manager.get_price_history("5028", "7d")
    result = manager.request_price_history("5028", "7d")

    assert snapshot["status"] == "ready"
    assert snapshot["stale"] is False
    assert result["status"] == "fresh"
    manager._nam.get.assert_not_called()


def test_get_price_history_marks_stale_cache_without_dropping_data() -> None:
    manager = make_manager()
    stale_time = (manager._now() - timedelta(hours=2)).isoformat()
    manager._save_payload(build_payload(manager, fetched_at=stale_time))

    snapshot = manager.get_price_history("5028", "7d")

    assert snapshot["status"] == "ready"
    assert snapshot["stale"] is True
    assert snapshot["data"]["stats"]["latest"] == 0.0412


def test_price_history_cache_separates_ranges_for_the_same_item() -> None:
    manager = make_manager()
    manager._save_payload(build_payload(manager, range_key="7d"))
    manager._save_payload(
        build_payload(
            manager,
            range_key="30d",
            points=[
                {"timestamp": 1773273600000, "value": 0.031},
                {"timestamp": 1775865600000, "value": 0.044},
            ],
        )
    )

    hourly = manager.get_price_history("5028", "7d")
    daily = manager.get_price_history("5028", "30d")

    assert hourly["data"]["interval"] == "1h"
    assert daily["data"]["interval"] == "1d"
    assert hourly["data"]["stats"]["latest"] == 0.0412
    assert daily["data"]["stats"]["latest"] == 0.044


def test_on_reply_success_persists_cache_and_emits_update() -> None:
    manager = make_manager()
    manager._in_flight.add("5028:7d")
    reply = FakeReply(
        payload=json.dumps(
            {
                "item_id": "5028",
                "interval": "1h",
                "points": [
                    {"timestamp": 1775865600000, "value": 0.0379},
                    {"timestamp": 1775952000000, "value": 0.0412},
                ],
            }
        ).encode("utf-8"),
        properties={"itemId": "5028", "rangeKey": "7d", "hadCache": False},
    )

    manager._on_reply(reply)

    emitted = manager.history_updated.emit.call_args.args[0]
    snapshot = manager.get_price_history("5028", "7d")

    assert emitted["status"] == "ready"
    assert emitted["data"]["stats"]["latest"] == 0.0412
    assert snapshot["status"] == "ready"
    assert snapshot["data"]["stats"]["latest"] == 0.0412
    assert "5028:7d" not in manager._in_flight
    assert reply.deleted is True


def test_missing_cache_refresh_failure_emits_error_entry() -> None:
    manager = make_manager()
    manager._in_flight.add("5028:7d")
    reply = FakeReply(
        error=QNetworkReply.NetworkError.ConnectionRefusedError,
        error_string="upstream error",
        properties={"itemId": "5028", "rangeKey": "7d", "hadCache": False},
    )

    manager._on_reply(reply)

    emitted = manager.history_updated.emit.call_args.args[0]
    assert emitted["status"] == "error"
    assert emitted["errorMessage"] == "upstream error"
    assert reply.deleted is True


def test_stale_refresh_failure_keeps_cached_snapshot_and_skips_error_emit() -> None:
    manager = make_manager()
    stale_time = (manager._now() - timedelta(hours=8)).isoformat()
    manager._save_payload(
        build_payload(manager, range_key="30d", fetched_at=stale_time)
    )
    manager._in_flight.add("5028:30d")
    reply = FakeReply(
        error=QNetworkReply.NetworkError.TimeoutError,
        error_string="timed out",
        properties={"itemId": "5028", "rangeKey": "30d", "hadCache": True},
    )

    manager._on_reply(reply)
    snapshot = manager.get_price_history("5028", "30d")

    manager.history_updated.emit.assert_not_called()
    assert snapshot["status"] == "ready"
    assert snapshot["stale"] is True
    assert snapshot["data"]["stats"]["latest"] == 0.0412


def test_corrupt_cache_is_preserved_before_successful_rewrite(
    isolated_data_dir: Path,
) -> None:
    manager = make_manager()
    cache_path = manager._cache_path("5028", "7d")
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text("{broken", encoding="utf-8")

    assert manager._save_payload(build_payload(manager)) is True

    backups = list((isolated_data_dir / "price_history").glob("5028_7d.json.corrupt.*"))
    assert len(backups) == 1
    assert backups[0].read_text(encoding="utf-8") == "{broken"
    assert manager.get_price_history("5028", "7d")["status"] == "ready"
