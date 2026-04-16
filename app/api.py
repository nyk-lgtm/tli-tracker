"""
API bridge for TLI Tracker.

Core API class used by both the QWebChannel bridge (PySide6)
and directly by other Python components.
"""

import csv
import json
from typing import Any, Optional

from PySide6.QtWidgets import QFileDialog

from .cloud_prices import CloudPriceManager
from .overlay import set_click_through
from .price_history_manager import PriceHistoryManager
from .price_manager import PriceManager
from .session_manager import SessionManager
from .storage import (
    build_default_config,
    get_item_name,
    get_item_type,
    load_config,
    load_items,
    save_config,
    set_config_value,
)
from .tracker import Tracker
from .updater import Updater
from .version import VERSION


class Api:
    """
    API class providing all tracker functionality.

    For Qt/PySide6: Methods are called via ApiBridge (QWebChannel slots).
    Python-to-JS events are pushed via the bridge's pythonEvent signal.
    """

    def __init__(self):
        # Qt window references (set by qt_app.py)
        self._main_window = None
        self._overlay_window = None
        self._bridge = None

        # Overlay visibility state
        self._overlay_visible = False

        # Initialize managers
        self.prices = PriceManager()
        self.cloud_prices = CloudPriceManager()
        self.price_history = PriceHistoryManager()
        self.sessions = SessionManager()
        self.updater = Updater(
            on_state_change=lambda payload: self._push_to_ui("update_state", payload)
        )

        # Initialize tracker with update callback
        self.tracker = Tracker(
            self.prices,
            self.sessions,
            on_update=self._push_to_ui,
            cloud_prices=self.cloud_prices,
        )

        # refresh UI when cloud prices arrive
        self.cloud_prices.prices_updated.connect(self.tracker._backfill_cloud_prices)
        self.cloud_prices.prices_updated.connect(self.tracker._notify_state)
        self.price_history.history_updated.connect(
            lambda payload: self._push_to_ui("price_history", payload)
        )

    def _push_to_ui(self, event_type: str, data: Any) -> None:
        """
        Push an event from Python to JavaScript via QWebChannel.

        Emits the pythonEvent signal which JS listens to.
        """
        if not self._bridge:
            return

        try:
            self._bridge.emit_event(event_type, data)
        except Exception as e:
            print(f"Error pushing to UI: {e}")

    # === Tracker API ===

    def get_stats(self) -> dict:
        """Get current tracker statistics."""
        return self.tracker.get_stats()

    def request_initialization(self) -> dict:
        """Request bag initialization (user should sort bag after)."""
        return self.tracker.request_initialization()

    def set_display_mode(self, mode: str) -> dict:
        """Set display mode ('value' or 'items')."""
        self.tracker.set_display_mode(mode)
        return {"status": "ok", "mode": mode}

    def toggle_pause(self) -> dict:
        """Toggle pause state for the current session."""
        return self.tracker.toggle_pause()

    def reset_session(self) -> dict:
        """Reset the current tracking session."""
        self.tracker.reset_session()
        return {"status": "ok"}

    def reset_all(self) -> dict:
        """Reset all tracking state."""
        self.tracker.reset_all()
        return {"status": "ok"}

    # === Session History API ===

    def get_session_history(self) -> list:
        """Get all past sessions."""
        self.tracker.flush_current_session()
        return self.sessions.get_all()

    def get_recent_sessions(self, count: int = 10) -> list:
        """Get the N most recent sessions."""
        self.tracker.flush_current_session()
        return self.sessions.get_recent(count)

    def get_today_sessions(self) -> list:
        """Get all sessions from today."""
        self.tracker.flush_current_session()
        return self.sessions.get_today()

    def get_session_summary(self) -> dict:
        """Get aggregate statistics across all sessions."""
        self.tracker.flush_current_session()
        return self.sessions.get_stats_summary()

    def delete_session(self, session_id: str) -> dict:
        """Delete a session by ID."""
        self.tracker.flush_current_session()
        success = self.sessions.delete_session(session_id)
        return {"status": "ok" if success else "error"}

    def export_session_csv(self, session_id: str) -> dict:
        """
        Export a session to CSV file with one row per drop.

        Opens a native file save dialog and writes the CSV.
        """
        self.tracker.flush_current_session()
        # Load full session data
        session = self.sessions.get_session(session_id)
        if not session:
            return {"status": "error", "message": "Session not found"}

        # Open file save dialog
        file_path, _ = QFileDialog.getSaveFileName(
            self._main_window,
            "Export Session",
            f"session_{session_id[:8]}.csv",
            "CSV Files (*.csv)",
        )

        if not file_path:
            return {"status": "cancelled"}

        try:
            session_start = session.get("started_at", "")
            session_end = session.get("ended_at", "")

            rows = []
            for map_run in session.get("maps", []):
                map_start = map_run.get("started_at", "")
                map_end = map_run.get("ended_at", "")
                map_duration = map_run.get("duration_seconds", 0)
                is_league_zone = map_run.get("is_league_zone", False)
                investment = map_run.get("investment", 0)

                for drop in map_run.get("drops", []):
                    item_id = drop.get("item_id", "")
                    rows.append(
                        {
                            "session_id": session_id,
                            "session_start": session_start,
                            "session_end": session_end,
                            "map_start": map_start,
                            "map_end": map_end,
                            "map_duration_seconds": round(map_duration, 2),
                            "is_league_zone": is_league_zone,
                            "investment": investment,
                            "item_name": get_item_name(item_id),
                            "item_type": get_item_type(item_id) or "Other",
                            "item_id": item_id,
                            "quantity": drop.get("quantity", 0),
                            "value": drop.get("value", 0),
                            "drop_timestamp": drop.get("timestamp", ""),
                        }
                    )

            # Write CSV
            fieldnames = [
                "session_id",
                "session_start",
                "session_end",
                "map_start",
                "map_end",
                "map_duration_seconds",
                "is_league_zone",
                "investment",
                "item_name",
                "item_type",
                "item_id",
                "quantity",
                "value",
                "drop_timestamp",
            ]

            with open(file_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(rows)

            return {"status": "ok", "path": file_path, "rows": len(rows)}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    # === Price API ===

    def get_prices(self) -> dict:
        """Get the entire price database."""
        return self.prices.get_all()

    def get_price(self, item_id: str) -> Optional[float]:
        """Get price for a specific item."""
        return self.prices.get_price(item_id)

    def set_price(self, item_id: str, price: float) -> dict:
        """Manually set a price for an item."""
        self.prices.set_price(item_id, price)
        return {"status": "ok", "item_id": item_id, "price": price}

    def remove_price(self, item_id: str) -> dict:
        """Remove a price entry."""
        success = self.prices.remove_price(item_id)
        return {"status": "ok" if success else "error"}

    def get_price_history(self, item_id: str, range_key: str) -> dict:
        """Get the current cached price history snapshot for one item/range."""
        return self.price_history.get_price_history(item_id, range_key)

    def request_price_history(self, item_id: str, range_key: str) -> dict:
        """Queue a background refresh for one item/range if needed."""
        return self.price_history.request_price_history(item_id, range_key)

    # === Items API ===

    def get_items(self) -> dict:
        """Get the item database."""
        return load_items()

    def get_item_name(self, item_id: str) -> str:
        """Get the name for an item ID."""
        return get_item_name(item_id)

    # === Settings API ===

    def get_settings(self) -> dict:
        """Get application settings."""
        return load_config()

    def save_settings(self, settings: dict) -> dict:
        """Save application settings."""
        # check if cloud prices just got enabled
        old_config = load_config()
        was_enabled = old_config.get("cloud_prices_enabled", False)

        success = save_config(settings)
        self.tracker.refresh_runtime_config()
        # notify overlay so it picks up widget/setting changes
        self._push_to_ui("settings_update", {})

        # trigger immediate fetch when cloud prices toggled on
        now_enabled = settings.get("cloud_prices_enabled", False)
        if now_enabled and not was_enabled:
            self.cloud_prices.fetch()
        elif was_enabled and not now_enabled:
            # re-resolve all drops to local-only prices
            self.tracker._backfill_cloud_prices()
            self.tracker._notify_state()

        return {"status": "ok" if success else "error"}

    def reset_settings(self) -> dict:
        """Reset application settings to defaults."""
        default_settings = build_default_config()
        # check if cloud prices was enabled before reset
        old_config = load_config()
        was_cloud_enabled = old_config.get("cloud_prices_enabled", False)

        success = save_config(default_settings)
        self.tracker.refresh_runtime_config()

        # re-resolve drops if cloud prices was just disabled by reset
        if was_cloud_enabled:
            self.tracker._backfill_cloud_prices()
            self.tracker._notify_state()

        if self._overlay_window:
            self._push_to_ui("settings_reset", {})

        return {"status": "ok" if success else "error"}

    def get_setting(self, key: str) -> Any:
        """Get a single setting value."""
        config = load_config()
        return config.get(key)

    def set_setting(self, key: str, value: Any) -> dict:
        """Set a single setting value."""
        config = load_config()
        config[key] = value
        save_config(config)
        self.tracker.refresh_runtime_config()
        return {"status": "ok"}

    # === Game Path API ===

    def browse_game_log(self) -> dict:
        """Open a file dialog for the user to select UE_game.log."""
        file_path, _ = QFileDialog.getOpenFileName(
            self._main_window,
            "Select UE_game.log",
            "",
            "Log Files (UE_game.log);;All Files (*.*)",
        )
        if not file_path:
            return {"status": "cancelled"}
        return {"status": "ok", "path": file_path}

    # === Overlay API ===

    def set_overlay_opacity(self, opacity: float) -> dict:
        """Set overlay window opacity (via CSS background, not Qt window)."""
        try:
            # Save to settings
            config = load_config()
            config["overlay_opacity"] = opacity
            save_config(config)

            # Push settings update to overlay so it applies CSS opacity
            self._push_to_ui("settings_update", {})

            return {"status": "ok", "opacity": opacity}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def set_overlay_click_through(self, enabled: bool) -> dict:
        """Enable or disable click-through on overlay."""
        if not self._overlay_window:
            return {"status": "error", "message": "No overlay window"}

        try:
            hwnd = int(self._overlay_window.winId())
            success = set_click_through(hwnd, enabled)
            self._overlay_window.set_click_through(enabled)

            return {"status": "ok" if success else "error"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def set_overlay_click_through_temp(self, enabled: bool) -> dict:
        """Temporarily enable or disable click-through (doesn't save to config)."""
        if not self._overlay_window:
            return {"status": "error", "message": "No overlay window"}

        try:
            hwnd = int(self._overlay_window.winId())
            success = set_click_through(hwnd, enabled)
            self._overlay_window.set_click_through(enabled)

            return {"status": "ok" if success else "error"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def update_overlay_hint_region(self, payload: dict) -> dict:
        """Update the interactive screen region for the overlay edit hint."""
        if not self._overlay_window:
            return {"status": "error", "message": "No overlay window"}

        try:
            self._overlay_window.set_edit_hint_region(payload)
            return {"status": "ok"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def set_overlay_edit_hint_dismissed(self, dismissed: bool) -> dict:
        """Persist the first-run overlay edit hint dismissal state."""
        try:
            success = set_config_value("overlay_edit_hint_dismissed", dismissed)
            return {"status": "ok" if success else "error", "dismissed": dismissed}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def show_overlay(self) -> dict:
        """Show the overlay window."""
        if not self._overlay_window:
            return {"status": "error", "message": "No overlay window"}

        try:
            # Show the window
            self._overlay_window.show()
            self._overlay_visible = True

            # Push current state to overlay
            stats = self.tracker.get_stats()
            self._push_to_ui("state", stats)

            return {"status": "ok", "visible": True}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def hide_overlay(self) -> dict:
        """Hide the overlay window."""
        if not self._overlay_window:
            return {"status": "error", "message": "No overlay window"}

        try:
            self._overlay_window.hide()
            self._overlay_visible = False
            return {"status": "ok", "visible": False}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def toggle_overlay(self) -> dict:
        """Toggle overlay window visibility."""
        if not self._overlay_window:
            return {"status": "error", "message": "No overlay window"}

        try:
            if self._overlay_visible:
                self._overlay_window.hide()
                self._overlay_visible = False
                return {"status": "ok", "visible": False}
            else:
                # Show the window
                self._overlay_window.show()
                self._overlay_visible = True

                # Push current state to overlay
                stats = self.tracker.get_stats()
                self._push_to_ui("state", stats)

                return {"status": "ok", "visible": True}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def save_widget_layout(self, layout_json: str) -> dict:
        """Save widget layout to config."""
        try:
            widgets = json.loads(layout_json)
            config = load_config()
            config["widgets"] = widgets
            save_config(config)
            return {"status": "ok"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def set_overlay_edit_mode(self, enabled: bool) -> dict:
        """Enable or disable overlay edit mode."""
        if not self._overlay_window:
            return {"status": "error", "message": "No overlay window"}

        try:
            self._overlay_window.set_edit_mode(enabled)
            return {"status": "ok", "enabled": enabled}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def update_edit_mode_hotkey(self, hotkey: str) -> dict:
        """Update the edit mode hotkey at runtime."""
        if not self._qt_app:
            return {"status": "error", "message": "No Qt app reference"}

        try:
            success = self._qt_app.update_edit_mode_hotkey(hotkey)
            if success:
                return {"status": "ok", "hotkey": hotkey}
            else:
                return {"status": "error", "message": "Failed to update hotkey"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    # === Utility ===

    def ping(self) -> dict:
        """Simple ping to verify the API is working."""
        return {"status": "ok", "message": "pong"}

    # === Update API ===

    def get_version(self) -> str:
        """Get current application version."""
        return VERSION

    def get_update_state(self) -> dict:
        """Return the current updater snapshot."""
        return self.updater.get_update_state()

    def start_update_flow(self, trigger: str) -> dict:
        """Start a background update check/download cycle."""
        return self.updater.start_update_flow(trigger)

    def apply_downloaded_update(self) -> dict:
        """Launch the downloaded installer in silent mode."""
        return self.updater.apply_downloaded_update()
