from pathlib import Path

from app.log_parser import LogParser

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "logs"


def read_fixture(name: str) -> str:
    return (FIXTURE_DIR / name).read_text(encoding="utf-8")


def test_parse_bag_init_fixture() -> None:
    parser = LogParser()

    events = parser.parse_bag_init(read_fixture("bag_init.log"))

    assert len(events) == 20
    assert events[0].item_id == "100300"
    assert events[1].quantity == 1


def test_parse_bag_modifications_fixture() -> None:
    parser = LogParser()

    events = parser.parse_bag_modifications(read_fixture("bag_modify.log"))

    assert len(events) == 2
    assert events[0].item_id == "2001"
    assert events[0].quantity == 3


def test_parse_map_enter_and_exit_fixtures() -> None:
    parser = LogParser()

    enter_event = parser.parse_map_change(read_fixture("map_enter.log"))
    exit_event = parser.parse_map_change(read_fixture("map_exit.log"))

    assert enter_event is not None
    assert enter_event.entering is True
    assert exit_event is not None
    assert exit_event.entering is False


def test_parse_price_search_fixture() -> None:
    parser = LogParser()

    events = parser.parse_price_search(read_fixture("price_search.log"))

    assert len(events) == 1
    assert events[0].item_id == "2001"
    assert events[0].prices == [15.0, 16.0, 17.0]


def test_parse_bag_removals_captures_slot_teardown() -> None:
    parser = LogParser()
    text = (
        "BagMgr@:Modfy BagItem PageId = 1 SlotId = 2 ConfigBaseId = 3001 Num = 5\n"
        "BagMgr@:RemoveBagItem PageId = 103 SlotId = 8\n"
        "BagMgr@:RemoveBagItem PageId = 102 SlotId = 0\n"
    )

    mods = parser.parse_bag_modifications(text)
    removals = parser.parse_bag_removals(text)

    # modify events still parse as before
    assert len(mods) == 1
    assert mods[0].item_id == "3001"

    # both removals picked up, item ids absent (caller must resolve from state)
    assert len(removals) == 2
    assert removals[0].page_id == 103
    assert removals[0].slot_id == 8
    assert removals[1].page_id == 102
    assert removals[1].slot_id == 0


def test_parse_last_level_link_filters_by_level_type() -> None:
    parser = LogParser()
    # simulates a watcher chunk that captured both the map entry and the
    # subsequent return-to-hideout: the hideout line (level_type=0) comes
    # last and would mask the map record without the filter.
    text = (
        "LevelMgr@ LevelUid, LevelType, LevelId = 1091002 3 5002\n"
        "LevelMgr@ LevelUid, LevelType, LevelId = 111000 0 110\n"
    )

    # unfiltered → picks the hideout record (the last one)
    unfiltered = parser.parse_last_level_link(text)
    assert unfiltered is not None
    assert unfiltered.level_type == 0
    assert unfiltered.level_id == 110

    # filtered to gameplay maps → returns the T8-0 entry
    gameplay = parser.parse_last_level_link(text, level_type=3)
    assert gameplay is not None
    assert gameplay.level_type == 3
    assert gameplay.level_id == 5002
    assert gameplay.level_uid == 1091002
