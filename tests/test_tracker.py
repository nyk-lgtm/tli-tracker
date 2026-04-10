from pathlib import Path

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
    assert len(stats["session"]["drops"]) == 2
    assert any(event_type == "drop" for event_type, _ in events)


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
    assert len(stats["session"]["drops"]) == 2
    assert stats["session"]["map_count"] == 1
