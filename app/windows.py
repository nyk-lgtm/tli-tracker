"""
Qt window classes for TLI Tracker.

Provides MainWindow and OverlayWindow using QWebEngineView.
"""

import sys
from pathlib import Path
from typing import Optional

from PySide6.QtCore import Qt, QTimer, QUrl
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineCore import QWebEngineSettings
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QMainWindow

from app.dialogs import DialogResult, show_error, show_warning
from app.monitor_utils import find_game_window, get_game_monitor, get_primary_monitor


class MainWindow(QMainWindow):
    """Main application window with web-based UI."""

    def __init__(self, bridge, api):
        super().__init__()
        self.bridge = bridge
        self.api = api
        self.log_watcher = None
        self._retry_dialog = None
        self._config_load_warning_shown = False
        self._items_load_warning_shown = False

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

    def on_page_loaded(self, success: bool) -> None:
        """Called when the page finishes loading."""
        if not success:
            print("Failed to load main window page")
            return

        print("Main window loaded, starting log watcher...")
        self._try_start_watching()
        self._check_config_load_error()
        self._check_items_load_error()

    def _check_config_load_error(self) -> None:
        if self._config_load_warning_shown:
            return
        from app.storage import get_config_load_error, load_config

        # force config load so the startup warning sees any parse/read failure
        load_config()
        err = get_config_load_error()
        if err is None:
            return
        self._config_load_warning_shown = True
        show_warning(
            "Settings File Unreadable",
            "The settings file could not be read, so the app is using safe defaults "
            "for this session.",
            f"Error: {err}\n\n"
            "Your original file will be preserved as a timestamped .corrupt backup "
            "the next time settings are saved.",
        )

    def _check_items_load_error(self) -> None:
        if self._items_load_warning_shown:
            return
        from app.storage import get_items_load_error, load_items

        # force the lazy load so the error state is populated before we check it
        load_items()
        err = get_items_load_error()
        if err is None:
            return
        self._items_load_warning_shown = True
        show_warning(
            "Item Database Unavailable",
            'The item database failed to load. Drops will show as "Unknown" '
            "until this is resolved.",
            f"Error: {err}\n\n"
            "Try reinstalling the application, or report this issue if it persists.",
        )

    def _try_start_watching(self) -> None:
        """Attempt to find game log and start watcher, show dialog if not found."""
        from app.log_watcher import LogWatcher

        log_path = self._find_game_log()
        if not log_path:
            return

        print(f"Found log file: {log_path}")
        self.log_watcher = LogWatcher(log_path, self.api.tracker.process_log_chunk)

        if self.log_watcher.start():
            self._bootstrap_tracker_from_recent_log()
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

    def _bootstrap_tracker_from_recent_log(self) -> None:
        """Restore current in-map state when the app starts mid-run."""
        if not self.log_watcher:
            return

        if not find_game_window():
            print("Game not running, skipping log bootstrap")
            return

        recent_log = self.log_watcher.read_tail()
        if recent_log and self.api.tracker.bootstrap_from_log_tail(recent_log):
            print("Bootstrapped current map state from recent log tail")
            return

        full_log = self.log_watcher.read_existing()
        if full_log and self.api.tracker.bootstrap_from_log_tail(full_log):
            print("Bootstrapped current map state from full log scan")

    def _find_game_log(self) -> Optional[str]:
        """
        Find the Torchlight Infinite log file.

        Tries in order: manual config path, cached path, live game detection.
        Returns path string or None if all strategies fail.
        """
        from app.storage import load_config

        config = load_config()

        # strategy 1: manual user-configured path
        manual_path = config.get("game_log_path", "")
        if manual_path:
            p = Path(manual_path)
            if p.exists() and p.is_file():
                self._cache_log_path(str(p))
                return str(p)
            print(f"Manual game_log_path not found: {manual_path}")

        # strategy 2: cached path from last successful detection
        cached_path = config.get("cached_log_path", "")
        if cached_path:
            p = Path(cached_path)
            if p.exists() and p.is_file():
                return str(p)
            print(f"Cached log path stale: {cached_path}")

        # strategy 3: live game detection
        result = self._detect_game_log_live()
        if result:
            self._cache_log_path(result)
            return result

        return None

    def _detect_game_log_live(self) -> Optional[str]:
        """Try to find game log via the running game process."""
        try:
            import psutil
            import win32gui
            import win32process
        except ImportError:
            return None

        hwnd = win32gui.FindWindow(None, "Torchlight: Infinite  ")
        if not hwnd:
            hwnd = win32gui.FindWindow(None, "Torchlight: Infinite")
        if not hwnd:
            self._show_retry_dialog(
                "Game Not Found",
                "Torchlight: Infinite is not running.",
                "Please start the game first, then click Retry.",
            )
            return None

        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        process = psutil.Process(pid)
        game_exe = process.exe()

        game_root = Path(game_exe).parent.parent.parent
        log_path = game_root / "TorchLight" / "Saved" / "Logs" / "UE_game.log"

        if not log_path.exists():
            self._show_retry_dialog(
                "Log File Not Found",
                "Could not find the game log file.",
                f"Expected location: {log_path}\n\n"
                "Make sure the game has fully loaded, then click Retry.",
            )
            return None

        return str(log_path)

    def _cache_log_path(self, log_path: str) -> None:
        """Update the cached log path in config."""
        from app.storage import load_config, save_config

        config = load_config()
        if config.get("cached_log_path") != log_path:
            config["cached_log_path"] = log_path
            save_config(config)

    def _show_retry_dialog(self, title: str, message: str, detail: str) -> None:
        """Show a non-modal retry/exit dialog that doesn't block the main window."""
        from app.dialogs import StyledDialog

        dialog = StyledDialog(
            title=title,
            message=message,
            detail=detail,
            icon="",
            show_retry=True,
            parent=self,
        )
        dialog.setWindowModality(Qt.WindowModality.NonModal)
        dialog.finished.connect(self._on_retry_dialog_closed)
        dialog.show()
        self._retry_dialog = dialog

    def _on_retry_dialog_closed(self) -> None:
        """Handle retry dialog result."""
        from PySide6.QtWidgets import QApplication

        dialog = self._retry_dialog
        self._retry_dialog = None

        if dialog.result_action == DialogResult.RETRY:
            self._try_start_watching()
        elif dialog.result_action == DialogResult.EXIT:
            QApplication.quit()

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
