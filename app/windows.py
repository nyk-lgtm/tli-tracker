"""
Qt window classes for TLI Tracker.

Provides MainWindow and OverlayWindow using QWebEngineView.
"""

import json

from pathlib import Path

from PySide6.QtCore import Qt, QUrl
from PySide6.QtWidgets import QMainWindow
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEngineSettings
from PySide6.QtWebChannel import QWebChannel


class MainWindow(QMainWindow):
    """Main application window with web-based UI."""

    def __init__(self, bridge, api):
        super().__init__()
        self.bridge = bridge
        self.api = api
        self.log_watcher = None

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
        self.web_view.setUrl(QUrl.fromLocalFile(str(html_path)))

        # Connect events
        self.web_view.loadFinished.connect(self.on_page_loaded)

    def _get_ui_path(self, filename: str) -> Path:
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
            raise RuntimeError(f"UI not found: {ui_path}")
        return ui_path.resolve()

    def on_page_loaded(self, success: bool) -> None:
        """Called when the page finishes loading."""
        if not success:
            print("Failed to load main window page")
            return

        print("Main window loaded, starting log watcher...")
        self._start_log_watcher()

    def _start_log_watcher(self) -> None:
        """Find game log and start watching."""
        try:
            from app.log_watcher import LogWatcher

            log_path = self._find_game_log()
            print(f"Found log file: {log_path}")

            self.log_watcher = LogWatcher(log_path, self.api.tracker.process_log_chunk)

            if self.log_watcher.start():
                print("Log watcher started successfully")
                self.bridge.emit_event("ready", {})
            else:
                self.bridge.emit_event("error", {"message": "Failed to start log watcher"})

        except RuntimeError as e:
            print(f"Error: {e}")
            self.bridge.emit_event("error", {"message": str(e)})

    def _find_game_log(self) -> str:
        """Find the Torchlight Infinite log file."""
        try:
            import win32gui
            import win32process
            import psutil
        except ImportError:
            raise RuntimeError("win32 modules required (install pywin32)")

        # Find the game window
        hwnd = win32gui.FindWindow(None, "Torchlight: Infinite  ")
        if not hwnd:
            hwnd = win32gui.FindWindow(None, "Torchlight: Infinite")

        if not hwnd:
            raise RuntimeError(
                "Torchlight: Infinite not found. "
                "Please start the game first."
            )

        # Get process ID from window handle
        _, pid = win32process.GetWindowThreadProcessId(hwnd)

        # Get executable path
        process = psutil.Process(pid)
        game_exe = process.exe()

        # Derive log path
        game_root = Path(game_exe).parent.parent.parent
        log_path = game_root / "TorchLight" / "Saved" / "Logs" / "UE_game.log"

        if not log_path.exists():
            raise RuntimeError(f"Log file not found: {log_path}")

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
        self.web_view.setUrl(QUrl.fromLocalFile(str(html_path)))

        self.hide()

    def _get_ui_path(self, filename: str) -> Path:
        """Get the path to a UI file."""
        import sys
        if getattr(sys, 'frozen', False):
            base_path = Path(sys.executable).parent
        else:
            base_path = Path(__file__).parent.parent

        ui_path = base_path / "ui" / filename
        if not ui_path.exists():
            raise RuntimeError(f"UI not found: {ui_path}")
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
