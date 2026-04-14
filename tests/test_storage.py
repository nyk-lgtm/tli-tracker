import json
from pathlib import Path

import pytest

from app import storage

# ===== JSON I/O =====


def test_load_json_returns_default_when_file_missing() -> None:
    assert storage.load_json("missing.json", default={"fallback": True}) == {
        "fallback": True
    }


def test_load_json_returns_empty_dict_when_missing_and_no_default() -> None:
    assert storage.load_json("missing.json") == {}


def test_load_json_returns_default_when_file_contains_invalid_json(
    isolated_data_dir: Path,
) -> None:
    (isolated_data_dir / "bad.json").write_text("{not valid", encoding="utf-8")
    assert storage.load_json("bad.json", default={"ok": False}) == {"ok": False}


def test_save_json_and_load_json_round_trip() -> None:
    payload = {"nested": {"a": [1, 2, 3]}, "bool": True, "num": 1.5}
    assert storage.save_json("state.json", payload) is True
    assert storage.load_json("state.json") == payload


# ===== Config =====


def test_load_config_adds_missing_keys_from_defaults() -> None:
    storage.save_json("config.json", {"display_mode": "items"})

    config = storage.load_config()

    assert config["display_mode"] == "items"
    for key in storage.DEFAULT_CONFIG:
        assert key in config


def test_load_config_preserves_existing_values() -> None:
    storage.save_json(
        "config.json",
        {"overlay_opacity": 0.42, "tax_enabled": True},
    )

    config = storage.load_config()

    assert config["overlay_opacity"] == 0.42
    assert config["tax_enabled"] is True


def test_load_config_populates_widgets_when_empty() -> None:
    from app.widget_registry import get_default_widgets

    storage.save_json("config.json", {"widgets": []})

    config = storage.load_config()

    assert config["widgets"] == get_default_widgets()


def test_load_config_re_adds_missing_registered_widgets() -> None:
    from app.widget_registry import get_default_widgets

    defaults = get_default_widgets()
    # simulate a config missing one of the registered widgets
    partial = [w for w in defaults if w["id"] != defaults[0]["id"]]
    storage.save_json("config.json", {"widgets": partial})

    config = storage.load_config()

    ids = {w["id"] for w in config["widgets"]}
    assert ids == {w["id"] for w in defaults}


def test_load_config_persists_migrated_config_to_disk() -> None:
    storage.save_json("config.json", {"display_mode": "items"})

    storage.load_config()
    raw = storage.load_json("config.json")

    # raw now has the full migrated set even though we only wrote one key
    for key in storage.DEFAULT_CONFIG:
        assert key in raw
    assert storage.get_config_load_error() is None


def test_load_config_does_not_rewrite_file_when_unchanged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage.save_config(storage.build_default_config())

    save_calls: list[dict] = []
    monkeypatch.setattr(
        storage,
        "save_config",
        lambda c: save_calls.append(c) or True,
    )

    storage.load_config()

    assert save_calls == []


def test_build_default_config_includes_full_widget_defaults() -> None:
    config = storage.build_default_config()

    for key in storage.DEFAULT_CONFIG:
        assert key in config
    assert config["widgets"]


def test_load_config_keeps_invalid_file_on_disk_and_records_error(
    isolated_data_dir: Path,
) -> None:
    config_path = isolated_data_dir / "config.json"
    config_path.write_text("{not valid", encoding="utf-8")

    config = storage.load_config()

    assert config["display_mode"] == "value"
    assert config["widgets"]
    assert isinstance(storage.get_config_load_error(), json.JSONDecodeError)
    assert config_path.read_text(encoding="utf-8") == "{not valid"


def test_save_config_preserves_invalid_file_before_writing_new_config(
    isolated_data_dir: Path,
) -> None:
    config_path = isolated_data_dir / "config.json"
    config_path.write_text("{not valid", encoding="utf-8")

    config = storage.load_config()
    config["tax_rate"] = 0.2

    assert storage.save_config(config) is True

    backups = list(isolated_data_dir.glob("config.json.corrupt.*"))
    assert len(backups) == 1
    assert backups[0].read_text(encoding="utf-8") == "{not valid"
    assert storage.load_json("config.json")["tax_rate"] == 0.2
    assert storage.get_config_load_error() is None


# ===== Config accessors =====


def test_get_config_value_returns_stored_value() -> None:
    config = storage.build_default_config()
    config["tax_rate"] = 0.2
    storage.save_config(config)
    assert storage.get_config_value("tax_rate") == 0.2


def test_get_config_value_returns_default_when_key_missing() -> None:
    storage.save_json("config.json", {})
    assert storage.get_config_value("nonexistent_key", "fallback") == "fallback"


def test_set_config_value_persists_value() -> None:
    assert storage.set_config_value("tax_rate", 0.15) is True
    assert storage.get_config_value("tax_rate") == 0.15


# ===== Items database =====


def test_get_item_name_returns_name_for_known_id() -> None:
    assert storage.get_item_name("2001") == "Divine Core"


def test_get_item_name_returns_unknown_placeholder_for_missing_id() -> None:
    assert storage.get_item_name("9999") == "Unknown (9999)"


def test_get_item_name_accepts_integer_id() -> None:
    assert storage.get_item_name(2001) == "Divine Core"


def test_get_item_type_returns_type_for_known_id() -> None:
    assert storage.get_item_type("3001") == "Relic"


def test_get_item_type_returns_none_for_missing_id() -> None:
    assert storage.get_item_type("9999") is None


def test_reload_items_rereads_from_disk(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_db = tmp_path / "item_ids.json"
    fake_db.write_text(
        json.dumps({"5555": {"name": "Phantom Ember", "type": "Currency"}}),
        encoding="utf-8",
    )
    monkeypatch.setattr(storage, "ITEMS_FILE", fake_db)

    storage.reload_items()

    assert storage.get_item_name("5555") == "Phantom Ember"
    # previously cached test items should be gone after the reload
    assert storage.get_item_name("2001") == "Unknown (2001)"


def test_load_items_returns_empty_cache_when_items_file_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(storage, "ITEMS_FILE", tmp_path / "nonexistent.json")

    assert storage.reload_items() == {}
    assert storage.get_item_name("2001") == "Unknown (2001)"


def test_load_items_records_error_when_items_file_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(storage, "ITEMS_FILE", tmp_path / "nonexistent.json")
    storage.reload_items()
    assert isinstance(storage.get_items_load_error(), FileNotFoundError)
