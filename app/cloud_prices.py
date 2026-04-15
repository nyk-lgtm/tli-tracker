import json
from datetime import datetime, timezone
from typing import Optional

from PySide6.QtCore import QObject, QUrl, Signal
from PySide6.QtNetwork import QNetworkAccessManager, QNetworkReply, QNetworkRequest

from .storage import (
    DATA_DIR,
    get_config_value,
    load_config,
    preserve_unreadable_file,
    save_json,
)

CLOUD_PRICES_URL = "https://api.tli-ahdb.workers.dev/prices"
CLOUD_PRICES_FILE = "cloud_prices.json"
FIXED_PRICE_IDS = {"100300"}
MAX_REASONABLE_CLOUD_PRICE = 1_000_000.0


class CloudPriceManager(QObject):
    """Fetches and caches crowd-sourced prices from the cloud proxy."""

    prices_updated = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._prices: dict[str, dict] = {}
        self._load_error: Exception | None = None
        self._nam = QNetworkAccessManager(self)
        self._nam.finished.connect(self._on_reply)
        self._load()

    def _file_path(self):
        return DATA_DIR / CLOUD_PRICES_FILE

    def _normalize_price_entry(
        self, item_id: str, price: object, updated_at: object
    ) -> dict[str, object] | None:
        """Validate and normalize one cloud price entry."""
        if not item_id or item_id in FIXED_PRICE_IDS:
            return None

        if not isinstance(updated_at, str) or not updated_at:
            return None

        try:
            numeric_price = float(price)
        except (TypeError, ValueError):
            return None

        # Defensive guard against poisoned worker payloads or stale bogus cache data.
        if numeric_price <= 0 or numeric_price > MAX_REASONABLE_CLOUD_PRICE:
            return None

        return {
            "price": round(numeric_price, 4),
            "updated_at": updated_at,
        }

    def _load(self) -> None:
        filepath = self._file_path()
        if not filepath.exists():
            self._prices = {}
            self._load_error = None
            return

        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict):
                raise ValueError(
                    "cloud_prices.json must contain a JSON object at the top level"
                )
            normalized_prices = {}
            dropped_entries = 0
            for item_id, entry in data.items():
                if not isinstance(entry, dict):
                    dropped_entries += 1
                    continue
                normalized_entry = self._normalize_price_entry(
                    str(item_id),
                    entry.get("price"),
                    entry.get("updated_at"),
                )
                if normalized_entry is None:
                    dropped_entries += 1
                    continue
                normalized_prices[str(item_id)] = normalized_entry

            if dropped_entries:
                print(
                    "[CloudPriceManager] Dropped "
                    f"{dropped_entries} invalid cached cloud price entries"
                )

            self._prices = normalized_prices
            self._load_error = None
        except (json.JSONDecodeError, PermissionError, OSError, ValueError) as e:
            print(f"[CloudPriceManager] Failed to load cloud prices cache: {e}")
            self._prices = {}
            self._load_error = e

    def _save(self) -> None:
        filepath = self._file_path()
        if self._load_error is not None and filepath.exists():
            if preserve_unreadable_file(filepath) is None:
                return

        if save_json(CLOUD_PRICES_FILE, self._prices):
            self._load_error = None
        else:
            print("[CloudPriceManager] Failed to save cloud prices cache")

    # --- query API ---

    def get_price(self, item_id: str) -> Optional[float]:
        entry = self._prices.get(item_id)
        return entry.get("price") if entry else None

    def get_price_with_tax(self, item_id: str) -> Optional[float]:
        price = self.get_price(item_id)
        if price is None:
            return None

        config = load_config()
        if config.get("tax_enabled", False) and item_id != "100300":
            tax_rate = config.get("tax_rate", 0.125)
            price = price * (1 - tax_rate)

        return price

    def get_price_age(self, item_id: str) -> Optional[float]:
        """Age in seconds based on ETor's updatedAt timestamp."""
        entry = self._prices.get(item_id)
        if not entry or "updated_at" not in entry:
            return None
        try:
            updated_str = entry["updated_at"]
            # handle both Z suffix and +00:00
            if updated_str.endswith("Z"):
                updated_str = updated_str[:-1] + "+00:00"
            updated_at = datetime.fromisoformat(updated_str)
            now = datetime.now(timezone.utc)
            return (now - updated_at).total_seconds()
        except (ValueError, TypeError):
            return None

    def get_price_status(self, item_id: str) -> str:
        age = self.get_price_age(item_id)
        if age is None:
            return "unknown"
        if age < 3600:
            return "fresh"
        if age < 18000:
            return "stale"
        return "old"

    def has_cached_data(self) -> bool:
        return len(self._prices) > 0

    # --- fetch ---

    def fetch(self) -> None:
        """Async fetch from cloud proxy. No-op if disabled."""
        if not get_config_value("cloud_prices_enabled", False):
            return
        request = QNetworkRequest(QUrl(CLOUD_PRICES_URL))
        self._nam.get(request)

    def _on_reply(self, reply: QNetworkReply) -> None:
        try:
            if reply.error() != QNetworkReply.NetworkError.NoError:
                print(f"Cloud price fetch failed: {reply.errorString()}")
                return

            data = json.loads(bytes(reply.readAll().data()))

            if not data.get("success") or "data" not in data:
                print("Cloud price response: unexpected format")
                return

            # replace entire cache so delisted items don't linger
            new_prices = {}
            dropped_entries = 0
            for item in data["data"]:
                item_id = str(item.get("id", ""))
                normalized_entry = self._normalize_price_entry(
                    item_id,
                    item.get("price"),
                    item.get("updatedAt", ""),
                )
                if normalized_entry is None:
                    dropped_entries += 1
                    continue
                new_prices[item_id] = normalized_entry
            count = len(new_prices)

            self._prices = new_prices
            self._save()
            if dropped_entries:
                print(
                    "Cloud prices: dropped "
                    f"{dropped_entries} invalid entries from fetch"
                )
            print(f"Cloud prices updated: {count} items")
            self.prices_updated.emit()
        finally:
            reply.deleteLater()
