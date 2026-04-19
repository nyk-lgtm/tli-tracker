from pathlib import Path

from app.api import Api


class DummyTracker:
    def __init__(self) -> None:
        self.flush_calls = 0

    def flush_current_session(self) -> bool:
        self.flush_calls += 1
        return True

    def refresh_runtime_config(self) -> None:
        return None


class DummySessions:
    def __init__(self, session: dict | None = None) -> None:
        self._session = session or {"id": "session-1", "maps": []}

    def get_all(self) -> list[dict]:
        return [self._session]

    def get_recent(self, count: int) -> list[dict]:
        return [self._session][:count]

    def get_today(self) -> list[dict]:
        return [self._session]

    def get_stats_summary(self) -> dict:
        return {"total_sessions": 1}

    def delete_session(self, session_id: str) -> bool:
        return session_id == self._session["id"]

    def get_session(self, session_id: str) -> dict | None:
        if session_id != self._session["id"]:
            return None
        return self._session


class DummyUpdater:
    def __init__(self) -> None:
        self.trigger_calls: list[str] = []
        self.state = {"status": "idle", "current_version": "0.2.2"}
        self.apply_result = {"status": "ok"}

    def get_update_state(self) -> dict:
        return self.state

    def start_update_flow(self, trigger: str) -> dict:
        self.trigger_calls.append(trigger)
        return {"status": "checking", "trigger": trigger}

    def apply_downloaded_update(self) -> dict:
        return self.apply_result


class DummyThemes:
    def __init__(self) -> None:
        self.entries = [
            {
                "id": "default",
                "name": "Default",
                "description": "",
                "builtin": True,
                "mode": "dark",
            }
        ]
        self.active_id = "default"

    def list_themes(self) -> list[dict]:
        return list(self.entries)

    def get_active_theme_id(self) -> str:
        return self.active_id


class DummyOverlayWindow:
    def __init__(self) -> None:
        self.hint_region_payload = None

    def set_edit_hint_region(self, payload: dict) -> None:
        self.hint_region_payload = payload


def make_api_stub(session: dict | None = None) -> Api:
    api = Api.__new__(Api)
    api.tracker = DummyTracker()
    api.sessions = DummySessions(session)
    api.updater = DummyUpdater()
    api._main_window = None
    api._overlay_window = None
    return api


def test_history_reads_flush_current_session() -> None:
    api = make_api_stub()

    history = api.get_session_history()
    summary = api.get_session_summary()

    assert history == [{"id": "session-1", "maps": []}]
    assert summary == {"total_sessions": 1}
    assert api.tracker.flush_calls == 2


def test_export_flushes_before_loading_session(tmp_path: Path, monkeypatch) -> None:
    api = make_api_stub(
        {
            "id": "session-1",
            "started_at": "2024-01-01T00:00:00",
            "ended_at": None,
            "maps": [
                {
                    "started_at": "2024-01-01T00:00:00",
                    "ended_at": "2024-01-01T00:05:00",
                    "duration_seconds": 300,
                    "is_league_zone": False,
                    "investment": 0,
                    "drops": [
                        {
                            "item_id": "2001",
                            "quantity": 2,
                            "value": 25.0,
                            "timestamp": "2024-01-01T00:02:00",
                        }
                    ],
                }
            ],
        }
    )
    export_path = tmp_path / "session.csv"

    monkeypatch.setattr(
        "app.api.QFileDialog.getSaveFileName",
        lambda *args, **kwargs: (str(export_path), "CSV Files (*.csv)"),
    )

    result = api.export_session_csv("session-1")

    assert result["status"] == "ok"
    assert export_path.exists()
    assert api.tracker.flush_calls == 1


def test_get_update_state_delegates_to_updater() -> None:
    api = make_api_stub()

    assert api.get_update_state() == {"status": "idle", "current_version": "0.2.2"}


def test_start_update_flow_delegates_to_updater() -> None:
    api = make_api_stub()

    result = api.start_update_flow("manual")

    assert result == {"status": "checking", "trigger": "manual"}
    assert api.updater.trigger_calls == ["manual"]


def test_apply_downloaded_update_delegates_to_updater() -> None:
    api = make_api_stub()
    api.updater.apply_result = {"status": "error", "error": "missing installer"}

    assert api.apply_downloaded_update() == {
        "status": "error",
        "error": "missing installer",
    }


def test_list_themes_includes_active_id() -> None:
    api = make_api_stub()
    api.themes = DummyThemes()

    assert api.list_themes() == {
        "themes": [
            {
                "id": "default",
                "name": "Default",
                "description": "",
                "builtin": True,
                "mode": "dark",
            }
        ],
        "active_id": "default",
    }


def test_update_overlay_hint_region_delegates_to_overlay_window() -> None:
    api = make_api_stub()
    overlay = DummyOverlayWindow()
    api._overlay_window = overlay

    payload = {"visible": True, "rect": {"x": 10, "y": 20, "width": 30, "height": 40}}
    result = api.update_overlay_hint_region(payload)

    assert result == {"status": "ok"}
    assert overlay.hint_region_payload == payload


def test_set_overlay_edit_hint_dismissed_persists_config_value(monkeypatch) -> None:
    api = make_api_stub()
    recorded: list[tuple[str, bool]] = []

    monkeypatch.setattr(
        "app.api.set_config_value",
        lambda key, value: recorded.append((key, value)) or True,
    )

    result = api.set_overlay_edit_hint_dismissed(True)

    assert result == {"status": "ok", "dismissed": True}
    assert recorded == [("overlay_edit_hint_dismissed", True)]
