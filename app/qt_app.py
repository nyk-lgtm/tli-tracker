"""
Qt-based TLI Tracker application.

Main entry point using PySide6 + QWebEngineView.
"""

import sys

from PySide6.QtWidgets import QApplication
from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QIcon

from app.api import Api
from app.bridge import ApiBridge
from app.windows import MainWindow, OverlayWindow
from app.storage import load_config
from app.version import VERSION
from app.hotkey import hotkey_manager


class TLITrackerApp:
    """Main application class for TLI Tracker."""

    def __init__(self):
        # Enable high DPI scaling
        QApplication.setHighDpiScaleFactorRoundingPolicy(
            Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
        )

        self.app = QApplication(sys.argv)
        self.app.setApplicationName("TLI Tracker")
        # icon_path = get_resource_path("ui/assets/logo.ico")
        self.app.setWindowIcon(QIcon("ui/assets/logo.ico"))

        # Create API instance
        self.api = Api()

        # Create heartbeat timer for real-time UI updates
        self.timer = QTimer()
        self.timer.timeout.connect(self.api.tracker._notify_state)
        self.timer.start(1000)  # Update every 1 second

        # Create bridge for QWebChannel communication
        self.bridge = ApiBridge(self.api)

        # Create windows
        self.main_window = MainWindow(self.bridge, self.api)
        self.overlay_window = OverlayWindow(self.bridge)

        # Store references in Api for window control
        self.api._main_window = self.main_window
        self.api._overlay_window = self.overlay_window
        self.api._bridge = self.bridge
        self.api._qt_app = self  # For hotkey updates

        # Load saved overlay position
        self._restore_overlay_position()

        # Set up global hotkeys for widget overlay
        self._setup_hotkeys()

    def _restore_overlay_position(self) -> None:
        """Initialize overlay click-through state."""
        # Widget overlay: always click-through (edit mode toggles this)
        self.overlay_window.set_click_through(True)

    def _setup_hotkeys(self) -> None:
        """Set up global hotkeys for widget overlay."""
        config = load_config()

        # Register edit mode toggle hotkey
        hotkey = config.get("overlay_edit_mode_hotkey", "Ctrl+F9")
        self._edit_mode_hotkey_id = hotkey_manager.register(
            hotkey, self._toggle_edit_mode
        )

        # Register ESC for exiting edit mode
        hotkey_manager.register("ESC", self._exit_edit_mode)

        # Start polling
        hotkey_manager.start()

    def update_edit_mode_hotkey(self, new_hotkey: str) -> bool:
        """Update the edit mode hotkey at runtime."""
        if not hasattr(self, "_edit_mode_hotkey_id") or not self._edit_mode_hotkey_id:
            return False

        return hotkey_manager.update_hotkey(self._edit_mode_hotkey_id, new_hotkey)

    def _toggle_edit_mode(self) -> None:
        """Toggle overlay edit mode."""
        if self.overlay_window.isVisible():
            self.overlay_window.toggle_edit_mode()

    def _exit_edit_mode(self) -> None:
        """Exit overlay edit mode (ESC key)."""
        if self.overlay_window.is_edit_mode():
            self.overlay_window.set_edit_mode(False)

    def run(self) -> int:
        """Run the application event loop."""
        print(f"TLI Tracker v{VERSION} starting...")
        self.main_window.show()
        return self.app.exec()

    def cleanup(self) -> None:
        """Clean up resources."""
        hotkey_manager.stop()


def main():
    """Main entry point."""
    app = TLITrackerApp()
    sys.exit(app.run())


if __name__ == "__main__":
    main()
