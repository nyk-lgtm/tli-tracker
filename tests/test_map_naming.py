import pytest

from app import storage
from app.map_naming import classify_tier, resolve_map_name


@pytest.fixture(autouse=True)
def beacon_item_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(
        storage._item_cache,
        "400007",
        {"name": "Glacial Abyss Beacon (Timemark 8)", "type": "Beacon"},
    )
    monkeypatch.setitem(
        storage._item_cache,
        "400008",
        {"name": "Deep Space Beacon", "type": "Beacon"},
    )


def test_classify_tier_known_ranges() -> None:
    assert classify_tier(4600) == "T7-0"
    assert classify_tier(4699) == "T7-0"
    assert classify_tier(4700) == "T7-1"
    assert classify_tier(4850) == "T7-2"
    # inclusive lower bound: 5000 is valid T8-0, not T7-2
    assert classify_tier(5000) == "T8-0"
    assert classify_tier(5002) == "T8-0"
    assert classify_tier(5099) == "T8-0"
    assert classify_tier(5100) == "T8-1"
    assert classify_tier(5150) == "T8-1"
    assert classify_tier(5250) == "T8-2"
    assert classify_tier(5303) == "T8 Profound"
    assert classify_tier(5399) == "T8 Profound"


def test_classify_tier_unknown_returns_none() -> None:
    assert classify_tier(None) is None
    assert classify_tier(0) is None
    # the gap between T7-2 and T8-0 is reserved (likely T7 Profound), but we
    # have no confirmed data so it must fall through rather than guess
    assert classify_tier(4900) is None
    assert classify_tier(4950) is None
    # Deep Space range is not in the tier table — beacon name uniquely
    # identifies it, so we don't synthesize a suffix
    assert classify_tier(5400) is None


def test_resolve_map_name_timemark_applies_tier_suffix() -> None:
    # 400007 = "Glacial Abyss Beacon (Timemark 8)"
    assert resolve_map_name(["400007"], 5002) == "Glacial Abyss (T8-0)"
    assert resolve_map_name(["400007"], 5150) == "Glacial Abyss (T8-1)"
    assert resolve_map_name(["400007"], 5250) == "Glacial Abyss (T8-2)"
    assert resolve_map_name(["400007"], 5303) == "Glacial Abyss (T8 Profound)"


def test_resolve_map_name_without_level_id_keeps_generic_parenthetical() -> None:
    # legacy sessions recorded before PR#4 won't have level_id; we still
    # strip " Beacon" from the base name but leave the (Timemark N) tag
    assert resolve_map_name(["400007"], None) == "Glacial Abyss (Timemark 8)"


def test_resolve_map_name_non_timemark_beacon_untouched() -> None:
    # 400008 = "Deep Space Beacon" — no (Timemark N) parenthetical to rewrite
    assert resolve_map_name(["400008"], 5400) == "Deep Space"
    # even without a level_id the beacon name is enough
    assert resolve_map_name(["400008"], None) == "Deep Space"


def test_resolve_map_name_empty_inputs_returns_empty() -> None:
    assert resolve_map_name([], 5002) == ""
    assert resolve_map_name([], None) == ""


def test_resolve_map_name_unknown_beacon_returns_empty() -> None:
    # an item id that isn't in item_ids.json must fall back so the UI
    # renders the numbered placeholder rather than "Unknown (999999)"
    assert resolve_map_name(["999999"], 5002) == ""
