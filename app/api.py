"""
API bridge for pywebview.

Exposes Python functions to JavaScript via pywebview's js_api.
"""

import json
from typing import Any, Optional

from .tracker import Tracker
from .price_manager import PriceManager
from .session_manager import SessionManager
from .storage import load_config, save_config, load_items, get_item_name
from .overlay import make_overlay, set_overlay_opacity, set_click_through


class Api:
    """
    API class exposed to JavaScript via pywebview.

    All public methods (not starting with _) are callable from JS:
        const result = await pywebview.api.method_name(args)
    """

    def __init__(self):
        self.window = None  # Main window reference
        self.overlay_window = None  # Overlay window reference

        # Initialize managers
        self.prices = PriceManager()
        self.sessions = SessionManager()

        # Initialize tracker with update callback
        self.tracker = Tracker(
            self.prices,
            self.sessions,
            on_update=self._push_to_ui
        )

    def set_window(self, window) -> None:
        """Set the main window reference (called from main.py)."""
        self.window = window

    def set_overlay_window(self, window) -> None:
        """Set the overlay window reference."""
        self.overlay_window = window

    def _push_to_ui(self, event_type: str, data: Any) -> None:
        """
        Push an event from Python to JavaScript.

        Calls window.onPythonEvent(type, data) in the frontend.
        """
        if not self.window:
            return

        try:
            json_data = json.dumps(data, default=str)
            self.window.evaluate_js(
                f'window.onPythonEvent("{event_type}", {json_data})'
            )

            # Also update overlay if it exists
            if self.overlay_window:
                self.overlay_window.evaluate_js(
                    f'window.onPythonEvent("{event_type}", {json_data})'
                )
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
        if not self.overlay_window:
            return {"status": "error", "message": "No overlay window"}

        try:
            hwnd = self.overlay_window.native_handle
            success = make_overlay(hwnd, opacity, click_through=True)
            return {"status": "ok" if success else "error"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def set_overlay_opacity(self, opacity: float) -> dict:
        """Set overlay window opacity."""
        if not self.overlay_window:
            return {"status": "error", "message": "No overlay window"}

        try:
            hwnd = self.overlay_window.native_handle
            success = set_overlay_opacity(hwnd, opacity)

            # Save to settings
            config = load_config()
            config["overlay_opacity"] = opacity
            save_config(config)

            return {"status": "ok" if success else "error"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def set_overlay_click_through(self, enabled: bool) -> dict:
        """Enable or disable click-through on overlay."""
        if not self.overlay_window:
            return {"status": "error", "message": "No overlay window"}

        try:
            hwnd = self.overlay_window.native_handle
            success = set_click_through(hwnd, enabled)
            return {"status": "ok" if success else "error"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def show_overlay(self) -> dict:
        """Show the overlay window and apply overlay effects."""
        if not self.overlay_window:
            return {"status": "error", "message": "No overlay window"}

        try:
            # Show the window
            self.overlay_window.show()

            # Apply overlay effects (transparent, click-through, topmost)
            config = load_config()
            opacity = config.get("overlay_opacity", 0.9)

            hwnd = self.overlay_window.native_handle
            make_overlay(hwnd, opacity, click_through=True)

            # Push current state to overlay
            stats = self.tracker.get_stats()
            self._push_to_ui("state", stats)

            return {"status": "ok", "visible": True}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def hide_overlay(self) -> dict:
        """Hide the overlay window."""
        if not self.overlay_window:
            return {"status": "error", "message": "No overlay window"}

        try:
            self.overlay_window.hide()
            return {"status": "ok", "visible": False}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def toggle_overlay(self) -> dict:
        """Toggle overlay window visibility."""
        if not self.overlay_window:
            return {"status": "error", "message": "No overlay window"}

        try:
            # Check if window is visible by trying to get its position
            # pywebview doesn't have a direct "is_visible" property
            # so we track it ourselves
            if not hasattr(self, '_overlay_visible'):
                self._overlay_visible = False

            if self._overlay_visible:
                self.overlay_window.hide()
                self._overlay_visible = False
                return {"status": "ok", "visible": False}
            else:
                self.overlay_window.show()

                # Apply overlay effects
                config = load_config()
                opacity = config.get("overlay_opacity", 0.9)
                hwnd = self.overlay_window.native_handle
                make_overlay(hwnd, opacity, click_through=True)

                # Push current state to overlay
                stats = self.tracker.get_stats()
                self._push_to_ui("state", stats)

                self._overlay_visible = True
                return {"status": "ok", "visible": True}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    # === Utility ===

    def ping(self) -> dict:
        """Simple ping to verify the API is working."""
        return {"status": "ok", "message": "pong"}
