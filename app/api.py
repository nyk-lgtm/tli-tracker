"""
API bridge for TLI Tracker.

Core API class used by both the QWebChannel bridge (PySide6)
and directly by other Python components.
"""

import json
from typing import Any, Optional

from .tracker import Tracker
from .price_manager import PriceManager
from .session_manager import SessionManager
from .storage import load_config, save_config, load_items, get_item_name
from .overlay import set_click_through


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
        self.sessions = SessionManager()

        # Initialize tracker with update callback
        self.tracker = Tracker(
            self.prices,
            self.sessions,
            on_update=self._push_to_ui
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
        return self.sessions.get_all()

    def get_recent_sessions(self, count: int = 10) -> list:
        """Get the N most recent sessions."""
        return self.sessions.get_recent(count)

    def get_today_sessions(self) -> list:
        """Get all sessions from today."""
        return self.sessions.get_today()

    def get_session_summary(self) -> dict:
        """Get aggregate statistics across all sessions."""
        return self.sessions.get_stats_summary()

    def delete_session(self, session_id: str) -> dict:
        """Delete a session by ID."""
        success = self.sessions.delete_session(session_id)
        return {"status": "ok" if success else "error"}

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
        success = save_config(settings)
        return {"status": "ok" if success else "error"}
    
    def reset_settings(self) -> dict:
        """Reset application settings to defaults."""
        default_settings = {
            "display_mode": "value",
            "overlay_opacity": 1,
            "overlay_pinned": False,
            "overlay_position": {"x": 100, "y": 100},
            "tax_enabled": False,
            "tax_rate": 0.125,
            "show_map_value": False,
        }
        success = save_config(default_settings)
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
        return {"status": "ok"}

    # === Overlay API ===

    def enable_overlay(self, opacity: float = 0.9) -> dict:
        """Enable overlay mode on the overlay window."""
        if not self._overlay_window:
            return {"status": "error", "message": "No overlay window"}

        try:
            # Set opacity using Qt's native method
            self._overlay_window.setWindowOpacity(opacity)

            # Enable click-through
            hwnd = int(self._overlay_window.winId())
            set_click_through(hwnd, True)

            return {"status": "ok"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def set_overlay_opacity(self, opacity: float) -> dict:
        """Set overlay window opacity."""
        if not self._overlay_window:
            return {"status": "error", "message": "No overlay window"}

        try:
            # Use Qt's native opacity control
            self._overlay_window.setWindowOpacity(opacity)

            # Save to settings
            config = load_config()
            config["overlay_opacity"] = opacity
            save_config(config)

            return {"status": "ok", "opacity": opacity}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def set_overlay_click_through(self, enabled: bool) -> dict:
        """Enable or disable click-through on overlay and save to config."""
        if not self._overlay_window:
            return {"status": "error", "message": "No overlay window"}

        try:
            hwnd = int(self._overlay_window.winId())
            success = set_click_through(hwnd, enabled)
            self._overlay_window.set_click_through(enabled)

            # Save pin state to config (pinned = click-through enabled)
            config = load_config()
            config["overlay_pinned"] = enabled
            save_config(config)

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

    def show_overlay(self) -> dict:
        """Show the overlay window."""
        if not self._overlay_window:
            return {"status": "error", "message": "No overlay window"}

        try:
            # Load and apply opacity
            config = load_config()
            opacity = config.get("overlay_opacity", 0.9)
            self._overlay_window.setWindowOpacity(opacity)

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
                # Load and apply opacity
                config = load_config()
                opacity = config.get("overlay_opacity", 0.9)
                self._overlay_window.setWindowOpacity(opacity)

                # Show the window
                self._overlay_window.show()
                self._overlay_visible = True

                # Push current state to overlay
                stats = self.tracker.get_stats()
                self._push_to_ui("state", stats)

                return {"status": "ok", "visible": True}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def move_overlay(self, delta_x: int, delta_y: int) -> dict:
        """Move overlay window by delta amount."""
        if not self._overlay_window:
            return {"status": "error", "message": "No overlay window"}

        try:
            # Get current position
            current_pos = self._overlay_window.pos()
            new_x = current_pos.x() + delta_x
            new_y = current_pos.y() + delta_y

            # Move window
            self._overlay_window.move(new_x, new_y)

            return {"status": "ok", "x": new_x, "y": new_y}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def save_overlay_position(self) -> dict:
        """Save current overlay position to config."""
        if not self._overlay_window:
            return {"status": "error", "message": "No overlay window"}

        try:
            pos = self._overlay_window.pos()
            config = load_config()
            config["overlay_position"] = {"x": pos.x(), "y": pos.y()}
            save_config(config)

            return {"status": "ok", "position": {"x": pos.x(), "y": pos.y()}}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    # === Utility ===

    def ping(self) -> dict:
        """Simple ping to verify the API is working."""
        return {"status": "ok", "message": "pong"}
