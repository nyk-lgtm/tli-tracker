"""
QWebChannel bridge for Qt-based TLI Tracker.

Exposes Python API to JavaScript via QWebChannel signals and slots.
"""

import json
from typing import Any

from PySide6.QtCore import QObject, Signal, Slot
from PySide6.QtWidgets import QApplication


class ApiBridge(QObject):
    """
    Bridge between Python API and JavaScript via QWebChannel.

    All methods exposed to JS must be decorated with @Slot and return JSON strings.
    Python-to-JS events are emitted via the pythonEvent signal.
    """

    # Signal for Python -> JS events: (event_type, json_data)
    pythonEvent = Signal(str, str)

    def __init__(self, api):
        super().__init__()
        self.api = api

    def emit_event(self, event_type: str, data: Any) -> None:
        """Emit an event to JavaScript."""
        json_data = json.dumps(data, default=str)
        self.pythonEvent.emit(event_type, json_data)

    # === Tracker API ===

    @Slot(result=str)
    def get_stats(self) -> str:
        """Get current tracker statistics."""
        return json.dumps(self.api.get_stats(), default=str)

    @Slot(result=str)
    def request_initialization(self) -> str:
        """Request bag initialization."""
        return json.dumps(self.api.request_initialization(), default=str)

    @Slot(str, result=str)
    def set_display_mode(self, mode: str) -> str:
        """Set display mode ('value' or 'items')."""
        return json.dumps(self.api.set_display_mode(mode), default=str)

    @Slot(result=str)
    def reset_session(self) -> str:
        """Reset the current tracking session."""
        return json.dumps(self.api.reset_session(), default=str)

    @Slot(result=str)
    def reset_all(self) -> str:
        """Reset all tracking state."""
        return json.dumps(self.api.reset_all(), default=str)

    # === Session History API ===

    @Slot(result=str)
    def get_session_history(self) -> str:
        """Get all past sessions."""
        return json.dumps(self.api.get_session_history(), default=str)

    @Slot(int, result=str)
    def get_recent_sessions(self, count: int) -> str:
        """Get the N most recent sessions."""
        return json.dumps(self.api.get_recent_sessions(count), default=str)

    @Slot(result=str)
    def get_today_sessions(self) -> str:
        """Get all sessions from today."""
        return json.dumps(self.api.get_today_sessions(), default=str)

    @Slot(result=str)
    def get_session_summary(self) -> str:
        """Get aggregate statistics across all sessions."""
        return json.dumps(self.api.get_session_summary(), default=str)

    @Slot(str, result=str)
    def delete_session(self, session_id: str) -> str:
        """Delete a session by ID."""
        return json.dumps(self.api.delete_session(session_id), default=str)

    @Slot(str, result=str)
    def export_session_csv(self, session_id: str) -> str:
        """Export a session to CSV file."""
        return json.dumps(self.api.export_session_csv(session_id), default=str)

    # === Price API ===

    @Slot(result=str)
    def get_prices(self) -> str:
        """Get the entire price database."""
        return json.dumps(self.api.get_prices(), default=str)

    @Slot(str, result=str)
    def get_price(self, item_id: str) -> str:
        """Get price for a specific item."""
        return json.dumps(self.api.get_price(item_id), default=str)

    @Slot(str, float, result=str)
    def set_price(self, item_id: str, price: float) -> str:
        """Manually set a price for an item."""
        return json.dumps(self.api.set_price(item_id, price), default=str)

    @Slot(str, result=str)
    def remove_price(self, item_id: str) -> str:
        """Remove a price entry."""
        return json.dumps(self.api.remove_price(item_id), default=str)

    # === Items API ===

    @Slot(result=str)
    def get_items(self) -> str:
        """Get the item database."""
        return json.dumps(self.api.get_items(), default=str)

    @Slot(str, result=str)
    def get_item_name(self, item_id: str) -> str:
        """Get the name for an item ID."""
        return json.dumps(self.api.get_item_name(item_id), default=str)

    # === Settings API ===

    @Slot(result=str)
    def get_settings(self) -> str:
        """Get application settings."""
        return json.dumps(self.api.get_settings(), default=str)

    @Slot(str, result=str)
    def save_settings(self, settings_json: str) -> str:
        """Save application settings."""
        settings = json.loads(settings_json)
        return json.dumps(self.api.save_settings(settings), default=str)

    @Slot(result=str)
    def default_settings(self) -> str:
        """Reset application settings to defaults."""
        return json.dumps(self.api.reset_settings(), default=str)

    @Slot(str, result=str)
    def get_setting(self, key: str) -> str:
        """Get a single setting value."""
        return json.dumps(self.api.get_setting(key), default=str)

    @Slot(str, str, result=str)
    def set_setting(self, key: str, value_json: str) -> str:
        """Set a single setting value."""
        value = json.loads(value_json)
        return json.dumps(self.api.set_setting(key, value), default=str)

    # === Overlay API ===

    @Slot(float, result=str)
    def set_overlay_opacity(self, opacity: float) -> str:
        """Set overlay window opacity."""
        return json.dumps(self.api.set_overlay_opacity(opacity), default=str)

    @Slot(bool, result=str)
    def set_overlay_click_through(self, enabled: bool) -> str:
        """Enable or disable click-through on overlay."""
        return json.dumps(self.api.set_overlay_click_through(enabled), default=str)

    @Slot(bool, result=str)
    def set_overlay_click_through_temp(self, enabled: bool) -> str:
        """Temporarily enable or disable click-through (doesn't save to config)."""
        return json.dumps(self.api.set_overlay_click_through_temp(enabled), default=str)

    @Slot(result=str)
    def show_overlay(self) -> str:
        """Show the overlay window."""
        return json.dumps(self.api.show_overlay(), default=str)

    @Slot(result=str)
    def hide_overlay(self) -> str:
        """Hide the overlay window."""
        return json.dumps(self.api.hide_overlay(), default=str)

    @Slot(result=str)
    def toggle_overlay(self) -> str:
        """Toggle overlay window visibility."""
        return json.dumps(self.api.toggle_overlay(), default=str)

    @Slot(str, result=str)
    def save_widget_layout(self, layout_json: str) -> str:
        """Save widget layout to config."""
        return json.dumps(self.api.save_widget_layout(layout_json), default=str)

    @Slot(bool, result=str)
    def set_overlay_edit_mode(self, enabled: bool) -> str:
        """Enable or disable overlay edit mode."""
        return json.dumps(self.api.set_overlay_edit_mode(enabled), default=str)

    @Slot(str, result=str)
    def update_edit_mode_hotkey(self, hotkey: str) -> str:
        """Update the edit mode hotkey at runtime."""
        return json.dumps(self.api.update_edit_mode_hotkey(hotkey), default=str)

    # === Utility ===

    @Slot(result=str)
    def ping(self) -> str:
        """Simple ping to verify the API is working."""
        return json.dumps({"status": "ok", "message": "pong"})

    # === Update API ===

    @Slot(result=str)
    def get_version(self) -> str:
        """Get current application version."""
        return json.dumps(self.api.get_version(), default=str)

    @Slot(result=str)
    def check_for_update(self) -> str:
        """Check GitHub for a newer version."""
        return json.dumps(self.api.check_for_update(), default=str)

    @Slot(str, str, result=str)
    def download_update(self, download_url: str, version: str) -> str:
        """Download update installer."""
        return json.dumps(self.api.download_update(download_url, version), default=str)

    @Slot(str, result=str)
    def launch_installer(self, download_path: str) -> str:
        """Launch the downloaded installer."""
        return json.dumps(self.api.launch_installer(download_path), default=str)

    @Slot()
    def quit_app(self) -> None:
        """Quit the application."""
        QApplication.quit()
