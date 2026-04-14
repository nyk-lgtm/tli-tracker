import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock

from app import storage
from app.price_manager import PriceManager
from app.session_manager import SessionManager
from app.storage import build_default_config, load_config, save_config
from app.tracker import Tracker

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "logs"
DROP_PLUS_TWO = (
    "BagMgr@:Modfy BagItem PageId = 1 SlotId = 2 ConfigBaseId = 2001 Num = 3"
)


def read_fixture(name: str) -> str:
    return (FIXTURE_DIR / name).read_text(encoding="utf-8")


def fresh_timestamp() -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()


class FakeCloudPrices:
    """Minimal stand-in for CloudPriceManager that skips Qt and HTTP."""

    def __init__(self, prices=None):
        self._prices = prices or {}

    def get_price(self, item_id):
        entry = self._prices.get(item_id)
        return entry.get("price") if entry else None

    def get_price_age(self, item_id):
        entry = self._prices.get(item_id)
        if not entry or "updated_at" not in entry:
            return None
        updated = datetime.fromisoformat(entry["updated_at"])
        return (datetime.now(timezone.utc) - updated).total_seconds()

    def get_price_status(self, item_id):
        age = self.get_price_age(item_id)
        if age is None:
            return "unknown"
        if age < 3600:
            return "fresh"
        if age < 18000:
            return "stale"
        return "old"


def make_cloud_tracker(cloud: FakeCloudPrices) -> Tracker:
    return Tracker(
        PriceManager(),
        SessionManager(),
        on_update=lambda *_: None,
        cloud_prices=cloud,
    )


# ===== Backfill on cloud disable / enable =====


def test_backfill_clears_cloud_only_value_when_cloud_disabled() -> None:
    cloud = FakeCloudPrices({"2001": {"price": 50.0, "updated_at": fresh_timestamp()}})
    save_config({"cloud_prices_enabled": True})
    tracker = make_cloud_tracker(cloud)

    tracker.process_log_chunk(read_fixture("bag_init.log"))
    tracker.process_log_chunk(read_fixture("map_enter.log"))
    tracker.process_log_chunk(DROP_PLUS_TWO)

    drop = tracker.state.current_map.drops[0]
    assert drop.item_id == "2001"
    assert drop.value == 100.0  # 50 * 2 from cloud

    save_config({"cloud_prices_enabled": False})
    tracker._backfill_cloud_prices()

    assert tracker.state.current_map.drops[0].value is None


def test_backfill_keeps_local_value_when_cloud_disabled() -> None:
    cloud = FakeCloudPrices({"2001": {"price": 100.0, "updated_at": fresh_timestamp()}})
    save_config({"cloud_prices_enabled": True})
    tracker = make_cloud_tracker(cloud)
    tracker.prices.set_price("2001", 80.0)

    tracker.process_log_chunk(read_fixture("bag_init.log"))
    tracker.process_log_chunk(read_fixture("map_enter.log"))
    tracker.process_log_chunk(DROP_PLUS_TWO)

    drop = tracker.state.current_map.drops[0]
    assert drop.value == 160.0  # 80 * 2 from local (newer)

    save_config({"cloud_prices_enabled": False})
    tracker._backfill_cloud_prices()

    assert tracker.state.current_map.drops[0].value == 160.0


def test_backfill_applies_cloud_price_when_cloud_enabled() -> None:
    cloud = FakeCloudPrices({"2001": {"price": 60.0, "updated_at": fresh_timestamp()}})
    save_config({"cloud_prices_enabled": False})
    tracker = make_cloud_tracker(cloud)

    tracker.process_log_chunk(read_fixture("bag_init.log"))
    tracker.process_log_chunk(read_fixture("map_enter.log"))
    tracker.process_log_chunk(DROP_PLUS_TWO)

    assert tracker.state.current_map.drops[0].value is None

    save_config({"cloud_prices_enabled": True})
    tracker._backfill_cloud_prices()

    assert tracker.state.current_map.drops[0].value == 120.0  # 60 * 2


# ===== reset_settings cloud handling =====


def _make_bare_api(cloud_was_enabled: bool):
    from app.api import Api

    save_config({"cloud_prices_enabled": cloud_was_enabled})

    api = Api.__new__(Api)
    api._overlay_window = None
    api.tracker = MagicMock()
    return api


def test_reset_settings_triggers_backfill_when_cloud_was_on() -> None:
    api = _make_bare_api(cloud_was_enabled=True)

    api.reset_settings()

    api.tracker._backfill_cloud_prices.assert_called_once()
    api.tracker._notify_state.assert_called_once()


def test_reset_settings_skips_backfill_when_cloud_was_off() -> None:
    api = _make_bare_api(cloud_was_enabled=False)

    api.reset_settings()

    api.tracker._backfill_cloud_prices.assert_not_called()


def test_reset_settings_restores_canonical_default_config() -> None:
    api = _make_bare_api(cloud_was_enabled=True)

    api.reset_settings()

    assert load_config() == build_default_config()


# ===== Cache replacement =====


def test_cache_replacement_prunes_delisted_items() -> None:
    from PySide6.QtNetwork import QNetworkReply

    from app.cloud_prices import CloudPriceManager

    mgr = CloudPriceManager.__new__(CloudPriceManager)
    mgr._prices = {
        "old_item": {"price": 10.0, "updated_at": "2025-01-01T00:00:00Z"},
        "kept_item": {"price": 20.0, "updated_at": "2025-01-01T00:00:00Z"},
    }
    mgr._save = MagicMock()
    mgr.prices_updated = MagicMock()

    reply = MagicMock()
    reply.error.return_value = QNetworkReply.NetworkError.NoError
    reply.readAll.return_value = MagicMock(
        data=lambda: json.dumps(
            {
                "success": True,
                "data": [
                    {
                        "id": "kept_item",
                        "price": 25.0,
                        "updatedAt": "2025-06-01T00:00:00Z",
                    },
                    {
                        "id": "new_item",
                        "price": 30.0,
                        "updatedAt": "2025-06-01T00:00:00Z",
                    },
                ],
            }
        ).encode()
    )
    reply.deleteLater = MagicMock()

    mgr._on_reply(reply)

    assert "old_item" not in mgr._prices
    assert "kept_item" in mgr._prices
    assert "new_item" in mgr._prices
    assert mgr._prices["kept_item"]["price"] == 25.0


def test_invalid_cloud_cache_is_preserved_on_next_save() -> None:
    from app.cloud_prices import CloudPriceManager

    cache_path = storage.DATA_DIR / "cloud_prices.json"
    cache_path.write_text("{broken", encoding="utf-8")

    mgr = CloudPriceManager.__new__(CloudPriceManager)
    mgr._prices = {}
    mgr._load_error = None

    mgr._load()

    assert mgr._prices == {}
    mgr._prices = {"2001": {"price": 7.5, "updated_at": fresh_timestamp()}}
    mgr._save()

    backups = list(storage.DATA_DIR.glob("cloud_prices.json.corrupt.*"))
    assert len(backups) == 1
    assert backups[0].read_text(encoding="utf-8") == "{broken"
    assert storage.load_json("cloud_prices.json")["2001"]["price"] == 7.5
