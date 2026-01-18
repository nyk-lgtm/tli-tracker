"""
Qt-based TLI Tracker application.

Main entry point using PySide6 + QWebEngineView.
"""

import sys
from pathlib import Path

from PySide6.QtWidgets import QApplication
from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QIcon

import app
from app.api import Api
from app.bridge import ApiBridge
from app.windows import MainWindow, OverlayWindow
from app.storage import load_config#, get_resource_path


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

        # Load saved overlay position
        self._restore_overlay_position()

    def _restore_overlay_position(self) -> None:
        """Restore overlay window position and pin state from config."""
        config = load_config()

        # Restore position
        position = config.get("overlay_position")
        if position:
            x, y = position.get("x", 100), position.get("y", 100)
            self.overlay_window.move(x, y)

        # Restore pin state (default to unpinned so button is clickable)
        pinned = config.get("overlay_pinned", False)
        self.overlay_window.set_click_through(pinned)

    def run(self) -> int:
        """Run the application event loop."""
        print("TLI Tracker v2 starting...")
        self.main_window.show()
        return self.app.exec()


def main():
    """Main entry point."""
    app = TLITrackerApp()
    sys.exit(app.run())


if __name__ == '__main__':
    main()
