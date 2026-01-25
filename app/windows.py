"""
Qt window classes for TLI Tracker.

Provides MainWindow and OverlayWindow using QWebEngineView.
"""

from pathlib import Path
from typing import Optional

from PySide6.QtCore import Qt, QUrl, QTimer
from PySide6.QtWidgets import QMainWindow
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEngineSettings
from PySide6.QtWebChannel import QWebChannel

from app.dialogs import show_error, DialogResult
from app.monitor_utils import get_game_monitor, get_primary_monitor


class MainWindow(QMainWindow):
    """Main application window with web-based UI."""

    def __init__(self, bridge, api):
        super().__init__()
        self.bridge = bridge
        self.api = api
        self.log_watcher = None
        self._last_dialog_was_retry = False
        self._last_dialog_was_exit = False

        self.setWindowTitle("TLI Tracker")
        self.resize(500, 800)
        self.setMinimumSize(450, 600)

        # Create web view
        self.web_view = QWebEngineView()
        self.setCentralWidget(self.web_view)

        # Enable settings for loading external resources (Tailwind CDN)
        settings = self.web_view.page().settings()
        settings.setAttribute(
            QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True
        )
        settings.setAttribute(
            QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True
        )
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

        if getattr(sys, "frozen", False):
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
                "The application may be corrupted. Please reinstall.",
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
        from PySide6.QtWidgets import QApplication

        # Retry loop for finding game
        while True:
            log_path = self._find_game_log()
            if log_path:
                break
            # _find_game_log shows dialog and returns None if not found
            # If user clicked Exit, close the app
            if self._last_dialog_was_exit:
                QApplication.quit()
                return
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
                "Try restarting the application.",
            )
            self.bridge.emit_event("error", {"message": "Failed to start log watcher"})

    def _find_game_log(self) -> Optional[str]:
        """
        Find the Torchlight Infinite log file.

        Returns:
            Path to log file, or None if not found (error dialog shown)
        """
        self._last_dialog_was_retry = False
        self._last_dialog_was_exit = False

        try:
            import win32gui
            import win32process
            import psutil
        except ImportError:
            show_error(
                "Missing Dependencies",
                "Required Windows modules are not installed.",
                "Please reinstall the application or install pywin32.",
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
            self._last_dialog_was_retry = result == DialogResult.RETRY
            self._last_dialog_was_exit = result == DialogResult.EXIT
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
            self._last_dialog_was_retry = result == DialogResult.RETRY
            self._last_dialog_was_exit = result == DialogResult.EXIT
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
        self._edit_mode = False  # Edit mode state
        self._current_monitor = None  # Track current monitor geometry

        self.setWindowTitle("TLI Overlay")

        # Overlay window flags
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.Tool
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)

        # Widget overlay: full-screen canvas on game monitor
        self._update_to_game_monitor()

        # Create web view
        self.web_view = QWebEngineView()
        self.setCentralWidget(self.web_view)
        self.web_view.page().setBackgroundColor(Qt.GlobalColor.transparent)

        # Enable settings for loading external resources (Tailwind CDN)
        settings = self.web_view.page().settings()
        settings.setAttribute(
            QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True
        )
        settings.setAttribute(
            QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True
        )
        settings.setAttribute(QWebEngineSettings.WebAttribute.JavascriptEnabled, True)

        self.channel = QWebChannel()
        self.channel.registerObject("api", bridge)
        self.web_view.page().setWebChannel(self.channel)

        # Load overlay HTML
        html_path = self._get_ui_path("overlay.html")
        if html_path:
            self.web_view.setUrl(QUrl.fromLocalFile(str(html_path)))

        # Start monitor polling timer
        self._monitor_timer = QTimer()
        self._monitor_timer.timeout.connect(self._check_monitor_change)
        self._monitor_timer.start(5000)  # Check every 5 seconds

        self.hide()

    def _update_to_game_monitor(self) -> bool:
        """
        Update overlay to cover the game's monitor.

        Returns:
            True if monitor was found and overlay updated.
        """
        monitor = get_game_monitor()
        if not monitor:
            # Fallback to primary monitor
            monitor = get_primary_monitor()

        if not monitor:
            print("Could not detect any monitor")
            return False

        # Check if monitor changed
        if monitor == self._current_monitor:
            return False

        self._current_monitor = monitor
        self.setGeometry(
            monitor["x"],
            monitor["y"],
            monitor["width"],
            monitor["height"],
        )
        print(
            f"[Overlay] Sized to monitor: {monitor['width']}x{monitor['height']} "
            f"at ({monitor['x']}, {monitor['y']})"
        )
        return True

    def _check_monitor_change(self) -> None:
        """Check if game moved to different monitor and update overlay."""
        self._update_to_game_monitor()

    def _get_ui_path(self, filename: str) -> Optional[Path]:
        """Get the path to a UI file."""
        import sys

        if getattr(sys, "frozen", False):
            base_path = Path(sys.executable).parent
        else:
            base_path = Path(__file__).parent.parent

        ui_path = base_path / "ui" / filename
        if not ui_path.exists():
            show_error(
                "Installation Error",
                f"UI file not found: {filename}",
                f"Expected location: {ui_path}\n\n"
                "The application may be corrupted. Please reinstall.",
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

    def toggle_edit_mode(self) -> None:
        """Toggle edit mode on/off."""
        self.set_edit_mode(not self._edit_mode)

    def set_edit_mode(self, enabled: bool) -> None:
        """
        Enable or disable edit mode.

        In edit mode:
        - Click-through is disabled (window is interactive)
        - Widgets show resize handles and can be dragged
        - Visual overlay indicates edit mode
        """
        if self._edit_mode == enabled:
            return

        self._edit_mode = enabled
        print(f"[Overlay] Edit mode: {'enabled' if enabled else 'disabled'}")

        # Toggle click-through (disabled in edit mode)
        self._apply_click_through(not enabled)

        # Notify JavaScript
        self.bridge.emit_event("edit_mode", {"enabled": enabled})

    def is_edit_mode(self) -> bool:
        """Check if edit mode is active."""
        return self._edit_mode
