import subprocess
from pathlib import Path

import pytest
from PySide6.QtCore import QCoreApplication

from app import storage
from app.updater import Updater


@pytest.fixture
def qt_app() -> QCoreApplication:
    app = QCoreApplication.instance()
    if app is None:
        app = QCoreApplication([])
    return app


def build_config(**overrides) -> dict:
    config = storage.build_default_config()
    config.update(overrides)
    return config


def test_startup_flow_does_nothing_when_auto_download_disabled(
    qt_app: QCoreApplication, monkeypatch: pytest.MonkeyPatch
) -> None:
    storage.save_config(build_config(auto_download_updates=False))
    updater = Updater()
    calls: list[str] = []
    monkeypatch.setattr(updater, "_start_check_request", lambda: calls.append("check"))

    snapshot = updater.start_update_flow("startup")

    assert calls == []
    assert snapshot["status"] == "idle"


def test_startup_flow_begins_checking_when_auto_download_enabled(
    qt_app: QCoreApplication, monkeypatch: pytest.MonkeyPatch
) -> None:
    storage.save_config(build_config(auto_download_updates=True))
    updater = Updater()
    calls: list[str] = []
    monkeypatch.setattr(updater, "_start_check_request", lambda: calls.append("check"))

    snapshot = updater.start_update_flow("startup")

    assert calls == ["check"]
    assert snapshot["status"] == "checking"
    assert snapshot["trigger"] == "startup"


def test_manual_flow_can_transition_into_downloading(
    qt_app: QCoreApplication, monkeypatch: pytest.MonkeyPatch
) -> None:
    updater = Updater()

    def fake_check() -> None:
        updater._set_state(
            status="downloading",
            trigger="manual",
            new_version="0.2.3",
            progress_percent=0,
            error="",
        )

    monkeypatch.setattr(updater, "_start_check_request", fake_check)

    snapshot = updater.start_update_flow("manual")

    assert snapshot["status"] == "downloading"
    assert snapshot["new_version"] == "0.2.3"
    assert snapshot["trigger"] == "manual"


@pytest.mark.parametrize(
    "busy_state,progress",
    [("checking", 0), ("downloading", 42)],
)
def test_start_update_flow_deduplicates_busy_states(
    qt_app: QCoreApplication,
    monkeypatch: pytest.MonkeyPatch,
    busy_state: str,
    progress: int,
) -> None:
    updater = Updater()
    updater._set_state(
        status=busy_state,
        trigger="manual",
        new_version="0.2.3" if busy_state == "downloading" else "",
        progress_percent=progress,
    )
    calls: list[str] = []
    monkeypatch.setattr(updater, "_start_check_request", lambda: calls.append("check"))

    snapshot = updater.start_update_flow("manual")

    assert calls == []
    assert snapshot["status"] == busy_state
    assert snapshot["progress_percent"] == progress


def test_start_update_flow_returns_downloaded_snapshot_without_rechecking(
    qt_app: QCoreApplication, monkeypatch: pytest.MonkeyPatch
) -> None:
    updater = Updater()
    updater._set_state(
        status="downloaded",
        trigger="manual",
        new_version="0.2.3",
        progress_percent=100,
    )
    calls: list[str] = []
    monkeypatch.setattr(updater, "_start_check_request", lambda: calls.append("check"))

    snapshot = updater.start_update_flow("manual")

    assert calls == []
    assert snapshot["status"] == "downloaded"
    assert snapshot["new_version"] == "0.2.3"


@pytest.mark.parametrize("initial_state", ["up_to_date", "error"])
def test_manual_checks_are_allowed_again_after_terminal_states(
    qt_app: QCoreApplication,
    monkeypatch: pytest.MonkeyPatch,
    initial_state: str,
) -> None:
    updater = Updater()
    updater._set_state(status=initial_state, trigger="manual", error="boom")
    calls: list[str] = []
    monkeypatch.setattr(updater, "_start_check_request", lambda: calls.append("check"))

    snapshot = updater.start_update_flow("manual")

    assert calls == ["check"]
    assert snapshot["status"] == "checking"
    assert snapshot["trigger"] == "manual"


def test_apply_downloaded_update_uses_silent_installer_flags(
    qt_app: QCoreApplication, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    updater = Updater()
    installer_path = tmp_path / updater.INSTALLER_NAME
    installer_path.write_bytes(b"stub")
    updater._download_path = installer_path
    updater._set_state(
        status="downloaded",
        trigger="manual",
        new_version="0.2.3",
        progress_percent=100,
    )
    popen_calls: list[list[str]] = []

    def fake_popen(args, **kwargs):
        popen_calls.append(list(args))
        return object()

    monkeypatch.setattr("app.updater.subprocess.Popen", fake_popen)
    # these constants only exist on Windows
    if not hasattr(subprocess, "DETACHED_PROCESS"):
        monkeypatch.setattr(
            "app.updater.subprocess.DETACHED_PROCESS", 0x00000008, raising=False
        )
        monkeypatch.setattr(
            "app.updater.subprocess.CREATE_NEW_PROCESS_GROUP", 0x00000200, raising=False
        )

    result = updater.apply_downloaded_update()

    assert result == {"status": "ok"}
    assert popen_calls == [
        [
            str(installer_path),
            "/VERYSILENT",
            "/SUPPRESSMSGBOXES",
            "/SP-",
            "/NORESTART",
        ]
    ]


def test_config_migration_backfills_auto_download_updates() -> None:
    storage.save_json("config.json", {"display_mode": "items"})

    config = storage.load_config()

    assert config["auto_download_updates"] is True
    assert storage.load_json("config.json")["auto_download_updates"] is True
