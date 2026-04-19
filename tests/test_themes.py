import json
from pathlib import Path

import pytest

from app.themes import ThemeManager


def build_theme(
    theme_id: str,
    *,
    name: str | None = None,
    description: str = "",
    primary: str = "#0d9488",
) -> dict:
    return {
        "id": theme_id,
        "name": name or theme_id.title(),
        "description": description,
        "mode": "dark",
        "palette": {
            "bg": "#0c1220",
            "surface": "#151e2c",
            "border": "#2a3441",
            "text": "#f1f5f9",
            "text-muted": "#94a3b8",
            "primary": primary,
            "success": "#22d3ee",
            "warning": "#f59e0b",
            "danger": "#f87171",
            "accent": "#38bdf8",
        },
    }


def write_theme(path: Path, theme: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(theme, indent=2), encoding="utf-8")


@pytest.fixture
def theme_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "theme-env"
    builtin_dir = root / "data" / "themes" / "_builtin"
    write_theme(builtin_dir / "default.json", build_theme("default", name="Default"))

    data_dir = root / "user-data"
    monkeypatch.setattr(
        "app.themes.get_resource_path", lambda relative_path: root / relative_path
    )
    monkeypatch.setattr("app.themes.ensure_data_dir", lambda: data_dir)
    monkeypatch.setattr(ThemeManager, "_start_watcher", lambda self: None)

    return root


def test_get_active_theme_id_falls_back_to_default(
    theme_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.themes.load_config", lambda: {"theme": "missing"})

    manager = ThemeManager()

    assert manager.get_active_theme_id() == "default"


def test_custom_theme_reload_only_notifies_on_real_changes(
    theme_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.themes.load_config", lambda: {"theme": "default"})
    notifications: list[str] = []
    manager = ThemeManager(on_themes_changed=lambda: notifications.append("changed"))

    manager.save_custom_theme(build_theme("aurora", name="Aurora"))
    assert notifications == ["changed"]

    manager._on_custom_change()
    assert notifications == ["changed"]

    custom_path = manager.custom_dir / "aurora.json"
    write_theme(custom_path, build_theme("aurora", name="Aurora v2", primary="#14b8a6"))
    manager._on_custom_change()

    assert notifications == ["changed", "changed"]
    assert manager.get_theme("aurora")["name"] == "Aurora v2"
