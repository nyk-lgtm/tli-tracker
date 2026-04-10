from datetime import datetime, timedelta

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
