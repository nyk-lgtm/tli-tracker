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
