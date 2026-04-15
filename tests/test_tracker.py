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
        },
        {
            "item_id": "3001",
            "item_name": "Ember Relic",
            "item_type": "Relic",
            "price_source": "local",
            "price_status": "unknown",
            "quantity": 1,
            "value": 0.0,
        },
    ]
    assert stats["session"]["category_totals"] == []
    assert any(event_type == "state" for event_type, _ in events)


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
