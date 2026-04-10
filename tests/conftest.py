from pathlib import Path

import pytest

from app import session_manager, storage


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "sessions").mkdir()

    monkeypatch.setattr(storage, "DATA_DIR", data_dir)
    monkeypatch.setattr(session_manager, "DATA_DIR", data_dir)
    monkeypatch.setattr(
        storage,
        "_item_cache",
        {
            "100300": {"name": "Flame Elementium", "type": "Currency"},
            "2001": {"name": "Divine Core", "type": "Currency"},
            "3001": {"name": "Ember Relic", "type": "Relic"},
        },
    )

    return data_dir
