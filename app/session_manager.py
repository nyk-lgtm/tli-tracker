"""
Session history manager.

Handles storing and retrieving farming session data
for analytics and historical tracking.
"""

from datetime import datetime
from typing import Optional
import uuid
import json

from .models import Session
from .storage import load_json, save_json, DATA_DIR


class SessionManager:
    """
    Manages session history persistence.

    Sessions are stored as a list in sessions.json, with the most
    recent sessions first. Old sessions can be pruned to limit storage.
    """

    FILENAME = "sessions.json"
    MAX_SESSIONS = 100  # Keep last N sessions

    def __init__(self):
        self._sessions: list[dict] = []
        self._load()

    def _load(self) -> None:
        """Load sessions from disk."""
        data = load_json(self.FILENAME, {"sessions": []})
        self._sessions = data.get("sessions", [])

    def _save(self) -> None:
        """Save sessions to disk."""
        # Prune old sessions
        self._sessions = self._sessions[: self.MAX_SESSIONS]
        save_json(self.FILENAME, {"sessions": self._sessions})

    def create_session(self) -> Session:
        """
        Create a new session.

        Returns:
            A new Session instance
        """
        return Session(id=str(uuid.uuid4()), started_at=datetime.now())

    def save_session(self, session: Session) -> None:
        """
        Save or update a session.

        Saves full session data to individual file (data/sessions/{id}.json)
        and summary data to sessions.json for the History UI.
        """
        # Save full session data to individual file
        session_file = DATA_DIR / "sessions" / f"{session.id}.json"
        with open(session_file, "w", encoding="utf-8") as f:
            json.dump(session.to_dict(), f, indent=2, ensure_ascii=False, default=str)

        # Generate summary (excludes heavy map data)
        summary_dict = session.to_summary_dict()

        # Check if session already exists in summary list
        for i, existing in enumerate(self._sessions):
            if existing.get("id") == session.id:
                self._sessions[i] = summary_dict
                self._save()
                return

        # Add new session summary at the beginning
        self._sessions.insert(0, summary_dict)
        self._save()

    def get_session(self, session_id: str) -> Optional[dict]:
        """Get a session by ID (loads full data from individual file)."""
        session_file = DATA_DIR / "sessions" / f"{session_id}.json"

        if not session_file.exists():
            return None

        try:
            with open(session_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return None

    def get_all(self) -> list[dict]:
        """Get all sessions (most recent first)."""
        return self._sessions.copy()

    def get_recent(self, count: int = 10) -> list[dict]:
        """Get the N most recent sessions."""
        return self._sessions[:count]

    def get_today(self) -> list[dict]:
        """Get all sessions from today."""
        today = datetime.now().date()
        result = []

        for session in self._sessions:
            try:
                started = datetime.fromisoformat(session.get("started_at", ""))
                if started.date() == today:
                    result.append(session)
            except (ValueError, TypeError):
                continue

        return result

    def get_stats_summary(self) -> dict:
        """
        Get aggregate statistics across all sessions.

        Returns:
            Dictionary with total_value, total_maps, total_time, etc.
        """
        total_value = 0.0
        total_maps = 0
        total_time = 0.0
        total_items = 0

        for session in self._sessions:
            # Use net_value if available (new format), fallback to total_value (old format)
            total_value += session.get("net_value", session.get("total_value", 0))
            total_maps += session.get("map_count", 0)
            total_time += session.get("session_duration", 0)
            total_items += session.get("total_items", 0)

        hours = total_time / 3600 if total_time > 0 else 0

        return {
            "total_sessions": len(self._sessions),
            "total_value": total_value,
            "total_maps": total_maps,
            "total_time_seconds": total_time,
            "total_time_hours": round(hours, 2),
            "total_items": total_items,
            "average_value_per_hour": round(total_value / hours, 2) if hours > 0 else 0,
            "average_value_per_map": round(total_value / total_maps, 2)
            if total_maps > 0
            else 0,
            "average_maps_per_hour": round(total_maps / hours, 2) if hours > 0 else 0,
        }

    def delete_session(self, session_id: str) -> bool:
        """Delete a session by ID (removes both summary and individual file)."""
        # Remove from summary list
        for i, session in enumerate(self._sessions):
            if session.get("id") == session_id:
                del self._sessions[i]
                self._save()

                # Delete individual session file
                session_file = DATA_DIR / "sessions" / f"{session_id}.json"
                if session_file.exists():
                    session_file.unlink()

                return True
        return False

    def clear_all(self) -> None:
        """Delete all session history (clears summaries and deletes all individual files)."""
        # Delete all individual session files
        sessions_dir = DATA_DIR / "sessions"
        if sessions_dir.exists():
            for session_file in sessions_dir.glob("*.json"):
                session_file.unlink()

        # Clear summary list
        self._sessions.clear()
        self._save()
