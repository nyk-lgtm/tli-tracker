"""
Session history manager.

Handles storing and retrieving farming session data
for analytics and historical tracking.
"""

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from .models import Session
from .storage import (
    DATA_DIR,
    get_item_name,
    get_item_type,
    preserve_unreadable_file,
    save_json,
)


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

    def _summary_path(self) -> Path:
        return DATA_DIR / self.FILENAME

    def _sessions_dir(self) -> Path:
        return DATA_DIR / "sessions"

    def _load_summary_file(self) -> list[dict]:
        summary_file = self._summary_path()
        if not summary_file.exists():
            return []

        with open(summary_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        if not isinstance(data, dict):
            raise ValueError(
                "sessions.json must contain a JSON object at the top level"
            )

        sessions = data.get("sessions", [])
        if not isinstance(sessions, list):
            raise ValueError("sessions.json field 'sessions' must be a JSON array")

        return sessions

    def _rebuild_summary_from_session_files(self) -> list[dict]:
        """Rebuild the summary index from the per-session files on disk."""
        summaries: list[dict] = []
        sessions_dir = self._sessions_dir()
        if not sessions_dir.exists():
            return summaries

        for session_file in sessions_dir.glob("*.json"):
            try:
                with open(session_file, "r", encoding="utf-8") as f:
                    record = json.load(f)
                if not isinstance(record, dict):
                    raise ValueError(
                        f"{session_file.name} must contain a JSON object "
                        "at the top level"
                    )
                if not record.get("id") or not record.get("started_at"):
                    raise ValueError(
                        f"{session_file.name} is missing required session fields"
                    )
                summary = dict(record)
                summary.pop("maps", None)
                summaries.append(summary)
            except (json.JSONDecodeError, PermissionError, OSError, ValueError) as e:
                print(
                    "[SessionManager] Skipping unreadable session file "
                    f"{session_file.name}: {e}"
                )

        summaries.sort(key=lambda session: session.get("started_at", ""), reverse=True)
        return summaries[: self.MAX_SESSIONS]

    def _load(self) -> None:
        """Load sessions from disk."""
        try:
            self._sessions = self._load_summary_file()
        except (json.JSONDecodeError, PermissionError, OSError, ValueError) as e:
            print(f"[SessionManager] Failed to load sessions summary: {e}")
            self._sessions = self._rebuild_summary_from_session_files()
            summary_file = self._summary_path()
            if (
                summary_file.exists()
                and preserve_unreadable_file(summary_file) is not None
            ):
                self._save()

    def _save(self) -> None:
        """Save sessions to disk."""
        # Prune old sessions
        self._sessions = self._sessions[: self.MAX_SESSIONS]
        if not save_json(self.FILENAME, {"sessions": self._sessions}):
            print("[SessionManager] Failed to save sessions summary")

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
        except (json.JSONDecodeError, IOError) as e:
            print(f"[SessionManager] Failed to load session {session_id}: {e}")
            return None

    def session_as_stats(self, session_id: str) -> Optional[dict]:
        """Render a stored session in the same shape as Tracker.get_stats()."""
        stored = self.get_session(session_id)
        if not stored:
            return None

        ignored_ids = set(stored.get("ignored_item_ids", []))
        started_at = datetime.fromisoformat(stored["started_at"])

        session_rows: dict[str, dict] = {}
        category_totals: dict[str, float] = {}
        maps_list: list[dict] = []
        display_map = None
        last_completed_map = None

        for index, map_dict in enumerate(stored.get("maps", [])):
            map_rows = self._aggregate_drops(
                map_dict.get("drops", []), ignored_ids, track_categories=False
            )
            # Fold this map's drops into the session-wide aggregate.
            self._aggregate_drops(
                map_dict.get("drops", []),
                ignored_ids,
                track_categories=True,
                rows=session_rows,
                categories=category_totals,
            )

            ended_at_iso = map_dict.get("ended_at")
            is_league = map_dict.get("is_league_zone", False)

            if ended_at_iso and not is_league:
                ended_at = datetime.fromisoformat(ended_at_iso)
                maps_list.append(
                    {
                        "index": index,
                        "total_value": map_dict.get("net_value", 0.0),
                        "duration_seconds": map_dict.get("duration_seconds", 0.0),
                        "ended_at_offset": (ended_at - started_at).total_seconds(),
                        "map_item_ids": map_dict.get("map_item_ids", []),
                        "consumable_ids": map_dict.get("consumable_ids", []),
                        "map_cost_snapshot": map_dict.get("map_cost_snapshot", {}),
                        "item_rows": list(map_rows.values()),
                    }
                )
                last_completed_map = (map_dict, map_rows)

        if last_completed_map is not None:
            map_dict, map_rows = last_completed_map
            display_map = {
                "duration": map_dict.get("duration_seconds", 0.0),
                "value": map_dict.get("net_value", 0.0),
                "items": map_dict.get("total_items", 0),
                "is_live": False,
                "ended_at": map_dict.get("ended_at"),
                "item_rows": list(map_rows.values()),
            }

        map_count = stored.get("map_count", 0)
        net_value = stored.get("net_value", 0.0)
        value_per_map = net_value / map_count if map_count else 0

        session = {
            "id": stored["id"],
            "paused": False,
            "duration_mapping": stored.get("total_duration", 0.0),
            "duration_total": stored.get("session_duration", 0.0),
            "value": net_value,
            "items": stored.get("total_items", 0),
            "map_count": map_count,
            "value_per_hour": stored.get("value_per_hour", 0),
            "value_per_map": value_per_map,
            "maps_per_hour": stored.get("maps_per_hour", 0),
            "item_rows": list(session_rows.values()),
            "category_totals": [
                {"item_type": item_type, "value": value}
                for item_type, value in sorted(
                    category_totals.items(), key=lambda kv: kv[1], reverse=True
                )
            ],
            "maps": maps_list,
        }

        return {
            "initialized": True,
            "awaiting_init": False,
            "in_map": False,
            "display_mode": "session",
            "current_map": None,
            "display_map": display_map,
            "session": session,
        }

    @staticmethod
    def _aggregate_drops(
        drops: list[dict],
        ignored_ids: set[str],
        track_categories: bool,
        rows: Optional[dict[str, dict]] = None,
        categories: Optional[dict[str, float]] = None,
    ) -> dict[str, dict]:
        """Aggregate drops into item_rows; optionally roll into category totals."""
        if rows is None:
            rows = {}
        for drop in drops:
            item_id = drop.get("item_id")
            if item_id is None:
                continue
            item_name = get_item_name(item_id)
            if item_name.startswith("Unknown ("):
                continue
            item_type = get_item_type(item_id) or "Other"
            is_ignored = item_id in ignored_ids
            entry = rows.setdefault(
                item_id,
                {
                    "item_id": item_id,
                    "item_name": item_name,
                    "item_type": item_type,
                    "quantity": 0,
                    "value": 0.0,
                    "price_status": "confirmed",
                    "price_source": "local",
                    "ignored": is_ignored,
                },
            )
            entry["ignored"] = is_ignored
            entry["quantity"] += drop.get("quantity", 0)
            value = drop.get("value")
            if value is not None:
                entry["value"] += value
                rolls_up = (
                    track_categories
                    and categories is not None
                    and not is_ignored
                    and value > 0
                )
                if rolls_up:
                    categories[item_type] = categories.get(item_type, 0.0) + value
        return rows

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
            # Use net_value if available (new format),
            # fallback to total_value for older session files.
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
        """Delete all session history and remove individual session files."""
        # Delete all individual session files
        sessions_dir = DATA_DIR / "sessions"
        if sessions_dir.exists():
            for session_file in sessions_dir.glob("*.json"):
                session_file.unlink()

        # Clear summary list
        self._sessions.clear()
        self._save()
