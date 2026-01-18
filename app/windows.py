"""
Qt window classes for TLI Tracker.

Provides MainWindow and OverlayWindow using QWebEngineView.
"""

import json
from pathlib import Path
from typing import Optional

from PySide6.QtCore import Qt, QUrl
from PySide6.QtWidgets import QMainWindow
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEngineSettings
from PySide6.QtWebChannel import QWebChannel

from app.dialogs import show_error, DialogResult


class MainWindow(QMainWindow):
    """Main application window with web-based UI."""

    def __init__(self, bridge, api):
        super().__init__()
        self.bridge = bridge
        self.api = api
        self.log_watcher = None
        self._last_dialog_was_retry = False

        self.setWindowTitle("TLI Tracker")
        self.resize(500, 800)
        self.setMinimumSize(450, 600)

        # Create web view
        self.web_view = QWebEngineView()
        self.setCentralWidget(self.web_view)

        # Enable settings for loading external resources (Tailwind CDN)
        settings = self.web_view.page().settings()
        settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)
        settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True)
        settings.setAttribute(QWebEngineSettings.WebAttribute.JavascriptEnabled, True)

        # Setup QWebChannel bridge
        self.channel = QWebChannel()
        self.channel.registerObject("api", bridge)
        self.web_view.page().setWebChannel(self.channel)

        # Load HTML
        html_path = self._get_ui_path("index.html")
        if html_path:
            self.web_view.setUrl(QUrl.fromLocalFile(str(html_path)))

        # Connect events
        self.web_view.loadFinished.connect(self.on_page_loaded)

    def _get_ui_path(self, filename: str) -> Optional[Path]:
        """Get the path to a UI file."""
        import sys
        if getattr(sys, 'frozen', False):
            # Running as compiled exe
            base_path = Path(sys.executable).parent
        else:
            # Running from source
            base_path = Path(__file__).parent.parent

        ui_path = base_path / "ui" / filename
        if not ui_path.exists():
            show_error(
                "Installation Error",
                f"UI file not found: {filename}",
                f"Expected location: {ui_path}\n\n"
                "The application may be corrupted. Please reinstall."
            )
            return None
        return ui_path.resolve()

    def on_page_loaded(self, success: bool) -> None:
        """Called when the page finishes loading."""
        if not success:
            print("Failed to load main window page")
            return

        print("Main window loaded, starting log watcher...")
        self._start_log_watcher()

    def _start_log_watcher(self) -> None:
        """Find game log and start watching (with retry support)."""
        from app.log_watcher import LogWatcher

        # Retry loop for finding game
        while True:
            log_path = self._find_game_log()
            if log_path:
                break
            # _find_game_log shows dialog and returns None if not found
            # If user didn't click Retry, exit the loop
            if not self._last_dialog_was_retry:
                self.bridge.emit_event("error", {"message": "Game not found"})
                return

        print(f"Found log file: {log_path}")
        self.log_watcher = LogWatcher(log_path, self.api.tracker.process_log_chunk)

        if self.log_watcher.start():
            print("Log watcher started successfully")
            self.bridge.emit_event("ready", {})
        else:
            show_error(
                "Log Watcher Error",
                "Failed to start log file monitoring.",
                "The game log file exists but could not be watched. "
                "Try restarting the application."
            )
            self.bridge.emit_event("error", {"message": "Failed to start log watcher"})

    def _find_game_log(self) -> Optional[str]:
        """
        Find the Torchlight Infinite log file.

        Returns:
            Path to log file, or None if not found (error dialog shown)
        """
        self._last_dialog_was_retry = False

        try:
            import win32gui
            import win32process
            import psutil
        except ImportError:
            show_error(
                "Missing Dependencies",
                "Required Windows modules are not installed.",
                "Please reinstall the application or install pywin32."
            )
            return None

        # Find the game window
        hwnd = win32gui.FindWindow(None, "Torchlight: Infinite  ")
        if not hwnd:
            hwnd = win32gui.FindWindow(None, "Torchlight: Infinite")

        if not hwnd:
            result = show_error(
                "Game Not Found",
                "Torchlight: Infinite is not running.",
                "Please start the game first, then click Retry.",
                show_retry=True,
            )
            self._last_dialog_was_retry = (result == DialogResult.RETRY)
            return None

        # Get process ID from window handle
        _, pid = win32process.GetWindowThreadProcessId(hwnd)

        # Get executable path
        process = psutil.Process(pid)
        game_exe = process.exe()

        # Derive log path
        game_root = Path(game_exe).parent.parent.parent
        log_path = game_root / "TorchLight" / "Saved" / "Logs" / "UE_game.log"

        if not log_path.exists():
            result = show_error(
                "Log File Not Found",
                "Could not find the game log file.",
                f"Expected location: {log_path}\n\n"
                "Make sure the game has fully loaded, then click Retry.",
                show_retry=True,
            )
            self._last_dialog_was_retry = (result == DialogResult.RETRY)
            return None

        return str(log_path)

    def closeEvent(self, event) -> None:
        """Handle window close."""
        print("Main window closing, cleaning up...")

        if self.log_watcher:
            self.log_watcher.stop()

        event.accept()


class OverlayWindow(QMainWindow):
    """Transparent overlay window for in-game display."""

    def __init__(self, bridge):
        super().__init__()
        self.bridge = bridge
        self._click_through_enabled = True

        self.setWindowTitle("TLI Overlay")
        self.resize(400, 50)

        # Overlay window flags
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint |
            Qt.WindowType.WindowStaysOnTopHint |
            Qt.WindowType.Tool
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)

        # Create web view
        self.web_view = QWebEngineView()
        self.setCentralWidget(self.web_view)
        self.web_view.page().setBackgroundColor(Qt.GlobalColor.transparent)

        # Enable settings for loading external resources (Tailwind CDN)
        settings = self.web_view.page().settings()
        settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)
        settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True)
        settings.setAttribute(QWebEngineSettings.WebAttribute.JavascriptEnabled, True)

        self.channel = QWebChannel()
        self.channel.registerObject("api", bridge)
        self.web_view.page().setWebChannel(self.channel)

        html_path = self._get_ui_path("overlay.html")
        if html_path:
            self.web_view.setUrl(QUrl.fromLocalFile(str(html_path)))

        self.hide()

    def _get_ui_path(self, filename: str) -> Optional[Path]:
        """Get the path to a UI file."""
        import sys
        if getattr(sys, 'frozen', False):
            base_path = Path(sys.executable).parent
        else:
            base_path = Path(__file__).parent.parent

        ui_path = base_path / "ui" / filename
        if not ui_path.exists():
            show_error(
                "Installation Error",
                f"UI file not found: {filename}",
                f"Expected location: {ui_path}\n\n"
                "The application may be corrupted. Please reinstall."
            )
            return None
        return ui_path.resolve()

    def showEvent(self, event) -> None:
        """Called when the window is shown."""
        super().showEvent(event)

        # Apply click-through on show
        if self._click_through_enabled:
            self._apply_click_through(True)

    def _apply_click_through(self, enabled: bool) -> None:
        """Apply click-through using Win32 API."""
        try:
            from app.overlay import set_click_through
            hwnd = int(self.winId())
            set_click_through(hwnd, enabled)
        except Exception as e:
            print(f"Failed to apply click-through: {e}")

    def set_click_through(self, enabled: bool) -> None:
        """Enable or disable click-through."""
        self._click_through_enabled = enabled
        if self.isVisible():
            self._apply_click_through(enabled)
