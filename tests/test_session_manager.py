import json
from datetime import datetime, timedelta

from app import storage
from app.models import Drop, MapRun, Session
from app.session_manager import SessionManager


def test_save_session_persists_summary_and_full_record() -> None:
    manager = SessionManager()

    session = Session(
        id="session-1",
        started_at=datetime.now() - timedelta(minutes=10),
        maps=[
            MapRun(
                started_at=datetime.now() - timedelta(minutes=9),
                ended_at=datetime.now() - timedelta(minutes=2),
                drops=[
                    Drop(
                        item_id="2001",
                        quantity=2,
                        timestamp=datetime.now() - timedelta(minutes=5),
                        value=25.0,
                    )
                ],
            )
        ],
    )

    manager.save_session(session)

    summary = manager.get_all()
    full_session = manager.get_session("session-1")

    assert len(summary) == 1
    assert summary[0]["id"] == "session-1"
    assert full_session is not None
    assert full_session["maps"][0]["drops"][0]["item_id"] == "2001"


def test_delete_session_removes_summary_and_file() -> None:
    manager = SessionManager()
    session = Session(id="session-2", started_at=datetime.now())
    manager.save_session(session)

    assert manager.delete_session("session-2") is True
    assert manager.get_all() == []
    assert manager.get_session("session-2") is None


def test_load_rebuilds_summary_from_full_session_files_when_index_corrupt() -> None:
    manager = SessionManager()
    session = Session(
        id="session-3",
        started_at=datetime.now() - timedelta(minutes=20),
        maps=[
            MapRun(
                started_at=datetime.now() - timedelta(minutes=18),
                ended_at=datetime.now() - timedelta(minutes=10),
            )
        ],
    )
    manager.save_session(session)

    summary_path = storage.DATA_DIR / "sessions.json"
    summary_path.write_text("{not valid", encoding="utf-8")

    rebuilt = SessionManager()

    summaries = rebuilt.get_all()
    assert len(summaries) == 1
    assert summaries[0]["id"] == "session-3"
    backups = list(storage.DATA_DIR.glob("sessions.json.corrupt.*"))
    assert len(backups) == 1
    persisted = json.loads(summary_path.read_text(encoding="utf-8"))
    assert persisted["sessions"][0]["id"] == "session-3"


def test_load_skips_corrupt_full_session_files_when_rebuilding_summary() -> None:
    sessions_dir = storage.DATA_DIR / "sessions"
    good_session = {
        "id": "session-good",
        "started_at": datetime.now().isoformat(),
        "ended_at": None,
        "total_value": 10.0,
        "total_investment": 0.0,
        "net_value": 10.0,
        "total_items": 1,
        "total_duration": 60.0,
        "session_duration": 60.0,
        "map_count": 1,
        "value_per_hour": 600.0,
        "maps_per_hour": 60.0,
        "paused_seconds": 0.0,
        "maps": [],
    }
    (sessions_dir / "session-good.json").write_text(
        json.dumps(good_session), encoding="utf-8"
    )
    (sessions_dir / "session-bad.json").write_text("{oops", encoding="utf-8")
    (storage.DATA_DIR / "sessions.json").write_text("{still bad", encoding="utf-8")

    rebuilt = SessionManager()

    summaries = rebuilt.get_all()
    assert [summary["id"] for summary in summaries] == ["session-good"]
