from pathlib import Path

import app.tracker as tracker_module
from app.price_manager import PriceManager
from app.session_manager import SessionManager
from app.storage import save_config
from app.tracker import Tracker

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "logs"
DROP_PLUS_ONE = (
    "BagMgr@:Modfy BagItem PageId = 1 SlotId = 2 ConfigBaseId = 2001 Num = 2"
)
DROP_PLUS_TWO = (
    "BagMgr@:Modfy BagItem PageId = 1 SlotId = 2 ConfigBaseId = 2001 Num = 3"
)
DROP_PLUS_FOUR = (
    "BagMgr@:Modfy BagItem PageId = 1 SlotId = 2 ConfigBaseId = 2001 Num = 5"
)


def read_fixture(name: str) -> str:
    return (FIXTURE_DIR / name).read_text(encoding="utf-8")


def make_tracker(events: list[tuple[str, dict]]) -> Tracker:
    return Tracker(
        PriceManager(),
        SessionManager(),
        on_update=lambda event_type, data: events.append((event_type, data)),
    )


def test_tracker_initializes_and_tracks_drop_during_map() -> None:
    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)

    tracker.process_log_chunk(read_fixture("bag_init.log"))
    tracker.process_log_chunk(read_fixture("map_enter.log"))
    tracker.process_log_chunk(read_fixture("bag_modify.log"))

    stats = tracker.get_stats()

    assert stats["initialized"] is True
    assert stats["in_map"] is True
    assert stats["session"] is not None
    assert "drops" not in stats["session"]
    assert stats["current_map"] is not None
    assert stats["current_map"]["items"] == 3
    assert stats["current_map"]["value"] == 0
    assert stats["current_map"]["duration"] >= 0
    assert sorted(stats["session"]["item_rows"], key=lambda item: item["item_id"]) == [
        {
            "item_id": "2001",
            "item_name": "Divine Core",
            "item_type": "Currency",
            "price_source": "local",
            "price_status": "unknown",
            "quantity": 2,
            "value": 0.0,
            "ignored": False,
        },
        {
            "item_id": "3001",
            "item_name": "Ember Relic",
            "item_type": "Relic",
            "price_source": "local",
            "price_status": "unknown",
            "quantity": 1,
            "value": 0.0,
            "ignored": False,
        },
    ]
    assert stats["session"]["category_totals"] == []
    assert any(event_type == "state" for event_type, _ in events)


def test_tracker_toggle_ignore_item_excludes_from_aggregates() -> None:
    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)

    tracker.process_log_chunk(read_fixture("bag_init.log"))
    tracker.process_log_chunk(read_fixture("map_enter.log"))
    tracker.process_log_chunk(read_fixture("bag_modify.log"))
    tracker.prices.set_price("2001", 10.0)
    tracker.prices.set_price("3001", 5.0)
    tracker._backfill_prices("2001")
    tracker._backfill_prices("3001")

    stats = tracker.get_stats()
    assert stats["session"]["value"] == 25.0
    assert stats["current_map"]["items"] == 3

    result = tracker.toggle_ignore_item("2001")
    assert result == {"status": "ok", "item_id": "2001", "ignored": True}

    stats = tracker.get_stats()
    assert stats["session"]["value"] == 5.0
    assert stats["current_map"]["items"] == 1
    row_2001 = next(r for r in stats["session"]["item_rows"] if r["item_id"] == "2001")
    assert row_2001["ignored"] is True
    assert row_2001["quantity"] == 2
    assert row_2001["value"] == 20.0

    result = tracker.toggle_ignore_item("2001")
    assert result == {"status": "ok", "item_id": "2001", "ignored": False}
    stats = tracker.get_stats()
    assert stats["session"]["value"] == 25.0
    assert stats["current_map"]["items"] == 3


def test_tracker_toggle_ignore_item_no_session() -> None:
    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)

    result = tracker.toggle_ignore_item("2001")
    assert result["status"] == "error"


def test_tracker_reset_session_saves_completed_session() -> None:
    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)

    tracker.process_log_chunk(read_fixture("bag_init.log"))
    tracker.process_log_chunk(read_fixture("map_enter.log"))
    tracker.process_log_chunk(read_fixture("bag_modify.log"))
    tracker.process_log_chunk(read_fixture("map_exit.log"))

    session_id = tracker.state.current_session.id
    tracker.reset_session()

    assert tracker.state.current_session is None
    assert tracker.sessions.get_session(session_id) is not None
    assert any(event_type == "session_reset" for event_type, _ in events)


def test_tracker_backfills_price_on_existing_drop() -> None:
    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)

    tracker.process_log_chunk(read_fixture("bag_init.log"))
    tracker.process_log_chunk(read_fixture("map_enter.log"))
    tracker.process_log_chunk(DROP_PLUS_TWO)

    assert tracker.state.current_map is not None
    assert tracker.state.current_map.drops[0].value is None

    tracker.prices.set_price("2001", 50.0)
    tracker._backfill_prices("2001")

    assert tracker.state.current_map.drops[0].value == 100.0


def test_tracker_defers_backfill_persistence_until_flush(monkeypatch) -> None:
    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)

    tracker.process_log_chunk(read_fixture("bag_init.log"))
    tracker.process_log_chunk(read_fixture("map_enter.log"))
    tracker.process_log_chunk(DROP_PLUS_ONE)
    tracker.process_log_chunk(read_fixture("map_exit.log"))
    tracker.process_log_chunk(read_fixture("map_enter.log"))
    tracker.process_log_chunk(DROP_PLUS_FOUR)

    saved_sessions = []
    monkeypatch.setattr(
        tracker.sessions,
        "save_session",
        lambda session: saved_sessions.append(session.id),
    )

    tracker.prices.set_price("2001", 10.0)
    tracker._backfill_prices("2001")

    assert saved_sessions == []
    assert tracker.state.current_map is not None
    assert tracker.state.current_map.drops[0].value == 30.0
    assert tracker.flush_current_session() is True
    assert saved_sessions == [tracker.state.current_session.id]
    assert tracker.flush_current_session() is False


def test_tracker_get_stats_includes_completed_and_current_map_drops() -> None:
    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)

    save_config({"investment_per_map": 5})
    tracker.process_log_chunk(read_fixture("bag_init.log"))
    tracker.process_log_chunk(read_fixture("map_enter.log"))
    tracker.process_log_chunk(DROP_PLUS_ONE)
    tracker.process_log_chunk(read_fixture("map_exit.log"))
    tracker.process_log_chunk(read_fixture("map_enter.log"))
    tracker.process_log_chunk(DROP_PLUS_FOUR)
    tracker.prices.set_price("2001", 10.0)
    tracker._backfill_prices("2001")

    stats = tracker.get_stats()

    assert stats["session"] is not None
    assert "drops" not in stats["session"]
    assert stats["session"]["map_count"] == 1
    assert stats["session"]["value"] == 30.0
    assert stats["session"]["items"] == 4
    assert sorted(stats["session"]["item_rows"], key=lambda item: item["item_id"]) == [
        {
            "item_id": "2001",
            "item_name": "Divine Core",
            "item_type": "Currency",
            "price_source": "local",
            "price_status": "fresh",
            "quantity": 4,
            "value": 40.0,
            "ignored": False,
        }
    ]
    assert stats["session"]["category_totals"] == [
        {"item_type": "Currency", "value": 40.0}
    ]


def test_split_init_burst_keeps_existing_stack_out_of_first_drop() -> None:
    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)

    init_chunk_one = "\n".join(
        [
            "BagMgr@:InitBagData PageId = 1 SlotId = 1 ConfigBaseId = 3001 Num = 1",
            "BagMgr@:InitBagData PageId = 1 SlotId = 2 ConfigBaseId = 2001 Num = 100",
            *[
                (
                    f"BagMgr@:InitBagData PageId = 1 SlotId = {slot} "
                    "ConfigBaseId = 3001 Num = 1"
                )
                for slot in range(3, 21)
            ],
        ]
    )
    init_chunk_two = "\n".join(
        [
            (
                f"BagMgr@:InitBagData PageId = 1 SlotId = {slot} "
                "ConfigBaseId = 3001 Num = 1"
            )
            for slot in range(21, 41)
        ]
    )

    tracker.process_log_chunk(init_chunk_one)
    tracker.process_log_chunk(init_chunk_two)
    tracker.process_log_chunk(read_fixture("map_enter.log"))
    tracker.process_log_chunk(
        "BagMgr@:Modfy BagItem PageId = 1 SlotId = 2 ConfigBaseId = 2001 Num = 101"
    )

    assert tracker.state.current_map is not None
    assert tracker.state.current_map.drops[0].item_id == "2001"
    assert tracker.state.current_map.drops[0].quantity == 1


def test_idle_bag_init_flushes_without_needing_map_reentry(monkeypatch) -> None:
    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)
    clock = {"now": 100.0}

    monkeypatch.setattr(tracker_module.time, "monotonic", lambda: clock["now"])

    tracker.request_initialization()
    tracker.process_log_chunk(read_fixture("bag_init.log"))

    waiting_stats = tracker.get_stats()
    assert waiting_stats["awaiting_init"] is True
    assert waiting_stats["initialized"] is False

    clock["now"] += Tracker.INIT_BURST_IDLE_SECONDS + 0.01

    initialized_stats = tracker.get_stats()
    assert initialized_stats["awaiting_init"] is False
    assert initialized_stats["initialized"] is True
    assert tracker.bag.initialized is True


def test_resync_inside_map_tracks_future_drops_after_init_settles(
    monkeypatch,
) -> None:
    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)
    clock = {"now": 100.0}

    monkeypatch.setattr(tracker_module.time, "monotonic", lambda: clock["now"])

    tracker.process_log_chunk(read_fixture("bag_init.log"))
    tracker.process_log_chunk(read_fixture("map_enter.log"))

    tracker.request_initialization()
    tracker.process_log_chunk(read_fixture("bag_init.log"))
    clock["now"] += Tracker.INIT_BURST_IDLE_SECONDS + 0.01

    settled_stats = tracker.get_stats()
    assert settled_stats["initialized"] is True
    assert settled_stats["awaiting_init"] is False
    assert settled_stats["in_map"] is True

    tracker.process_log_chunk(
        "BagMgr@:Modfy BagItem PageId = 1 SlotId = 2 ConfigBaseId = 2001 Num = 2"
    )

    stats = tracker.get_stats()
    assert stats["current_map"] is not None
    assert stats["current_map"]["items"] == 1
    assert stats["session"] is not None
    assert stats["session"]["item_rows"] == [
        {
            "item_id": "2001",
            "item_name": "Divine Core",
            "item_type": "Currency",
            "price_source": "local",
            "price_status": "unknown",
            "quantity": 1,
            "value": 0.0,
            "ignored": False,
        }
    ]


def test_bootstrap_mid_map_start_allows_sync_and_drop_tracking(monkeypatch) -> None:
    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)
    clock = {"now": 100.0}

    monkeypatch.setattr(tracker_module.time, "monotonic", lambda: clock["now"])

    assert tracker.bootstrap_from_log_tail(read_fixture("map_enter.log")) is True

    bootstrapped_stats = tracker.get_stats()
    assert bootstrapped_stats["in_map"] is True
    assert bootstrapped_stats["current_map"] is not None
    assert bootstrapped_stats["session"] is not None

    tracker.request_initialization()
    tracker.process_log_chunk(read_fixture("bag_init.log"))
    clock["now"] += Tracker.INIT_BURST_IDLE_SECONDS + 0.01

    tracker.get_stats()
    tracker.process_log_chunk(
        "BagMgr@:Modfy BagItem PageId = 1 SlotId = 2 ConfigBaseId = 2001 Num = 2"
    )

    stats = tracker.get_stats()
    assert stats["current_map"] is not None
    assert stats["current_map"]["items"] == 1
    assert stats["session"] is not None
    assert stats["session"]["item_rows"] == [
        {
            "item_id": "2001",
            "item_name": "Divine Core",
            "item_type": "Currency",
            "price_source": "local",
            "price_status": "unknown",
            "quantity": 1,
            "value": 0.0,
            "ignored": False,
        }
    ]


# ===== Pause / Resume =====


def test_toggle_pause_returns_paused_state() -> None:
    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)

    first = tracker.toggle_pause()
    assert first == {"status": "ok", "paused": True}
    assert tracker._is_paused is True

    second = tracker.toggle_pause()
    assert second == {"status": "ok", "paused": False}
    assert tracker._is_paused is False


def test_paused_tracker_does_not_capture_drops() -> None:
    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)

    tracker.process_log_chunk(read_fixture("bag_init.log"))
    tracker.process_log_chunk(read_fixture("map_enter.log"))

    tracker.toggle_pause()
    tracker.process_log_chunk(DROP_PLUS_TWO)

    assert tracker.state.current_map is not None
    assert tracker.state.current_map.drops == []


def test_resume_in_same_map_preserves_map_and_clears_paused_at() -> None:
    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)

    tracker.process_log_chunk(read_fixture("bag_init.log"))
    tracker.process_log_chunk(read_fixture("map_enter.log"))
    map_before = tracker.state.current_map

    tracker.toggle_pause()
    assert map_before.paused_at is not None
    tracker.toggle_pause()

    assert tracker.state.current_map is map_before
    assert tracker.state.is_in_map is True
    assert map_before.paused_at is None


def test_resume_after_leaving_map_during_pause_closes_map() -> None:
    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)

    tracker.process_log_chunk(read_fixture("bag_init.log"))
    tracker.process_log_chunk(read_fixture("map_enter.log"))

    tracker.toggle_pause()
    tracker.process_log_chunk(read_fixture("map_exit.log"))
    tracker.toggle_pause()

    assert tracker.state.current_map is None
    assert tracker.state.is_in_map is False
    assert tracker.state.current_session is not None
    assert len(tracker.state.current_session.maps) == 1
    assert tracker._session_persisted is True

    # live cache should reflect the just-closed map
    stats = tracker.get_stats()
    assert stats["session"]["map_count"] == 1


def test_resume_after_entering_map_during_pause_starts_fresh_map() -> None:
    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)

    tracker.process_log_chunk(read_fixture("bag_init.log"))

    tracker.toggle_pause()
    tracker.process_log_chunk(read_fixture("map_enter.log"))
    tracker.toggle_pause()

    assert tracker.state.current_map is not None
    assert tracker.state.is_in_map is True
    assert tracker.state.current_session is not None
    assert tracker.state.current_session.maps == []


def test_reset_session_clears_pause_state() -> None:
    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)

    tracker.process_log_chunk(read_fixture("bag_init.log"))
    tracker.process_log_chunk(read_fixture("map_enter.log"))
    tracker.toggle_pause()
    assert tracker._is_paused is True

    tracker.reset_session()

    assert tracker._is_paused is False
    assert tracker._pause_started_at is None


def test_map_entry_captures_beacon_when_slot_empties_via_remove(
    monkeypatch,
) -> None:
    # when a beacon stack hits zero, the game emits BagMgr@:RemoveBagItem
    # (no ConfigBaseId on the line) instead of Modfy with Num=0. without
    # the remove handler, the last of a stack silently slips out of the
    # delta and the map lands without a captured beacon.
    monkeypatch.setitem(
        tracker_module.get_item_name.__globals__["_item_cache"],
        "400006",
        {"name": "Glacial Abyss Beacon (Timemark 7)", "type": "Beacon"},
    )

    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)

    # seed bag state with exactly one beacon so the consume will remove the slot
    tracker.process_log_chunk(
        "BagMgr@:InitBagData PageId = 103 SlotId = 4 ConfigBaseId = 400006 Num = 1\n"
    )
    import time

    time.sleep(0.4)
    tracker.process_log_chunk("\n")

    # game emits RemoveBagItem because the stack hit zero; same tick, the
    # LevelMgr line and the _UpdateGameEnd arrive in separate chunks like
    # the watcher normally splits them.
    tracker.process_log_chunk("BagMgr@:RemoveBagItem PageId = 103 SlotId = 4\n")
    tracker.process_log_chunk(
        "LevelMgr@ LevelUid, LevelType, LevelId = 1081205 3 4829\n"
    )
    tracker.process_log_chunk(read_fixture("map_enter.log"))

    current_map = tracker.state.current_map
    assert current_map is not None
    assert current_map.map_item_ids == ["400006"]
    assert current_map.level_id == 4829  # T7-2 range


def test_map_entry_capture_tolerates_split_chunks(
    monkeypatch,
) -> None:
    # the game-log watcher fires on every file modification event, so the
    # beacon consumption, the LevelMgr line, and the _UpdateGameEnd line can
    # arrive in separate chunks. this test drives the tracker with those
    # three events split into three chunks (closest to real behavior) and
    # verifies MapRun still captures beacon/consumable/level_id.
    monkeypatch.setitem(
        tracker_module.get_item_name.__globals__["_item_cache"],
        "400007",
        {"name": "Glacial Abyss Beacon (Timemark 8)", "type": "Beacon"},
    )
    monkeypatch.setitem(
        tracker_module.get_item_name.__globals__["_item_cache"],
        "10010",
        {"name": "Novel Compass", "type": "Compass"},
    )

    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)

    # set initial bag state with one beacon and one compass in stock
    tracker.process_log_chunk(
        "BagMgr@:InitBagData PageId = 103 SlotId = 7 "
        "ConfigBaseId = 400007 Num = 1\n"
        "BagMgr@:InitBagData PageId = 103 SlotId = 8 "
        "ConfigBaseId = 10010 Num = 1\n"
    )
    # give the init burst time to flush
    import time

    time.sleep(0.4)
    tracker.process_log_chunk("\n")  # no-op to trigger idle flush

    # chunk 1: bag decrements the beacon + compass (player applies them)
    tracker.process_log_chunk(
        "BagMgr@:Modfy BagItem PageId = 103 SlotId = 7 "
        "ConfigBaseId = 400007 Num = 0\n"
        "BagMgr@:Modfy BagItem PageId = 103 SlotId = 8 "
        "ConfigBaseId = 10010 Num = 0\n"
    )

    # chunk 2: the LevelMgr line identifying the incoming map's level id.
    # 5002 is in the T8-0 range per the tier table.
    tracker.process_log_chunk(
        "LevelMgr@ LevelUid, LevelType, LevelId = 1091002 3 5002\n"
    )

    # chunk 3: the actual scene transition (map enter)
    tracker.process_log_chunk(read_fixture("map_enter.log"))

    current_map = tracker.state.current_map
    assert current_map is not None
    assert current_map.map_item_ids == ["400007"]
    assert current_map.consumable_ids == ["10010"]
    assert current_map.level_id == 5002


def test_display_map_is_live_while_in_map() -> None:
    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)

    tracker.process_log_chunk(read_fixture("bag_init.log"))
    tracker.process_log_chunk(read_fixture("map_enter.log"))
    tracker.process_log_chunk(read_fixture("bag_modify.log"))

    stats = tracker.get_stats()
    assert stats["display_map"] is not None
    assert stats["display_map"]["is_live"] is True
    assert stats["display_map"]["ended_at"] is None
    assert stats["display_map"]["items"] == 3
    item_ids = {row["item_id"] for row in stats["display_map"]["item_rows"]}
    assert item_ids == {"2001", "3001"}


def test_display_map_stays_after_map_exit() -> None:
    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)

    tracker.process_log_chunk(read_fixture("bag_init.log"))
    tracker.process_log_chunk(read_fixture("map_enter.log"))
    tracker.process_log_chunk(read_fixture("bag_modify.log"))
    tracker.process_log_chunk(read_fixture("map_exit.log"))

    stats = tracker.get_stats()
    assert stats["current_map"] is None
    assert stats["display_map"] is not None
    assert stats["display_map"]["is_live"] is False
    assert stats["display_map"]["ended_at"] is not None
    item_ids = {row["item_id"] for row in stats["display_map"]["item_rows"]}
    assert item_ids == {"2001", "3001"}


def test_display_map_cleared_on_session_reset() -> None:
    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)

    tracker.process_log_chunk(read_fixture("bag_init.log"))
    tracker.process_log_chunk(read_fixture("map_enter.log"))
    tracker.process_log_chunk(read_fixture("bag_modify.log"))
    tracker.process_log_chunk(read_fixture("map_exit.log"))

    assert tracker._last_map_run is not None

    tracker.reset_session()

    assert tracker._last_map_run is None
    assert tracker.get_stats()["display_map"] is None


def test_display_map_filters_ignored_items() -> None:
    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)

    tracker.process_log_chunk(read_fixture("bag_init.log"))
    tracker.process_log_chunk(read_fixture("map_enter.log"))
    tracker.process_log_chunk(read_fixture("bag_modify.log"))
    tracker.prices.set_price("2001", 10.0)
    tracker.prices.set_price("3001", 5.0)
    tracker._backfill_prices("2001")
    tracker._backfill_prices("3001")

    tracker.toggle_ignore_item("2001")
    stats = tracker.get_stats()

    row_2001 = next(
        r for r in stats["display_map"]["item_rows"] if r["item_id"] == "2001"
    )
    assert row_2001["ignored"] is True
    # ignored items excluded from the item count like the session view does
    assert stats["display_map"]["items"] == 1


def test_resync_midmap_preserves_last_map_run() -> None:
    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)

    tracker.process_log_chunk(read_fixture("bag_init.log"))
    tracker.process_log_chunk(read_fixture("map_enter.log"))
    tracker.process_log_chunk(read_fixture("bag_modify.log"))
    map_ref = tracker._last_map_run
    assert map_ref is not None

    tracker.request_initialization()

    # re-sync wipes live drops but must leave the sticky reference intact
    assert tracker._last_map_run is map_ref


def test_set_display_mode_accepts_legacy_values() -> None:
    from app.models import DisplayMode

    events: list[tuple[str, dict]] = []
    tracker = make_tracker(events)

    tracker.set_display_mode("value")
    assert tracker.state.display_mode is DisplayMode.SESSION

    tracker.set_display_mode("items")
    assert tracker.state.display_mode is DisplayMode.MAP

    tracker.set_display_mode("session")
    assert tracker.state.display_mode is DisplayMode.SESSION

    tracker.set_display_mode("map")
    assert tracker.state.display_mode is DisplayMode.MAP
