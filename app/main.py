"""
Main entry point for TLI Tracker.

Initializes the application, finds the game log,
and starts the pywebview GUI.
"""

import sys
import logging
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

import webview

# Suppress pywebview's noisy WebView2 interface warnings
logging.getLogger('pywebview').setLevel(logging.CRITICAL)

from app.api import Api
from app.log_watcher import LogWatcher
from app.storage import load_config, save_config


def find_game_log() -> str:
    """
    Find the Torchlight Infinite log file.

    Locates the game process and derives the log file path.

    Returns:
        Path to UE_game.log

    Raises:
        RuntimeError: If game is not found
    """
    try:
        import win32gui
        import win32process
        import psutil
    except ImportError:
        raise RuntimeError("win32 modules required (install pywin32)")

    # Find the game window
    # Note: There are two spaces after "Infinite" in the window title
    hwnd = win32gui.FindWindow(None, "Torchlight: Infinite  ")

    if not hwnd:
        # Try alternate window titles
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

    # Derive log path (relative to game exe)
    # Structure: .../Torchlight Infinite/UE_game/Binaries/Win64/torchlight_infinite.exe
    # Log at:    .../Torchlight Infinite/UE_game/TorchLight/Saved/Logs/UE_game.log
    game_root = Path(game_exe).parent.parent.parent
    log_path = game_root / "TorchLight" / "Saved" / "Logs" / "UE_game.log"

    if not log_path.exists():
        raise RuntimeError(f"Log file not found: {log_path}")

    return str(log_path)


def get_ui_path(filename: str = "index.html") -> str:
    """Get the path to a UI file."""
    # Check if running from source or packaged
    if getattr(sys, 'frozen', False):
        # Running as compiled exe
        base_path = Path(sys.executable).parent
    else:
        # Running from source
        base_path = Path(__file__).parent.parent

    ui_path = base_path / "ui" / filename

    if not ui_path.exists():
        raise RuntimeError(f"UI not found: {ui_path}")

    return str(ui_path)


def main():
    """Main entry point."""
    print("TLI Tracker v2 starting...")

    # Create API instance
    api = Api()

    # Get UI path
    try:
        ui_path = get_ui_path()
        print(f"UI path: {ui_path}")
    except RuntimeError as e:
        print(f"Error: {e}")
        sys.exit(1)

    # Load settings for window config
    config = load_config()

    # Create main window
    window = webview.create_window(
        title='TLI Tracker',
        url=ui_path,
        js_api=api,
        width=500,
        height=650,
        resizable=True,
        min_size=(400, 500)
    )

    # Create overlay window (starts hidden)
    overlay_path = get_ui_path("overlay.html")
    overlay_window = webview.create_window(
        title='TLI Overlay',
        url=overlay_path,
        js_api=api,
        width=400,
        height=50,
        resizable=False,
        frameless=True,
        on_top=True,
        hidden=True
    )

    # Store window references in API
    api.set_window(window)
    api.set_overlay_window(overlay_window)

    # Log watcher (will be started after window loads)
    log_watcher = None

    def on_loaded():
        """Called when the window is fully loaded."""
        nonlocal log_watcher

        print("Window loaded, starting log watcher...")

        try:
            log_path = find_game_log()
            print(f"Found log file: {log_path}")

            # Create and start log watcher
            log_watcher = LogWatcher(log_path, api.tracker.process_log_chunk)

            if log_watcher.start():
                print("Log watcher started successfully")
                # Notify UI that we're ready
                window.evaluate_js('window.onPythonEvent("ready", {})')
            else:
                window.evaluate_js(
                    'window.onPythonEvent("error", '
                    '{"message": "Failed to start log watcher"})'
                )

        except RuntimeError as e:
            print(f"Error: {e}")
            window.evaluate_js(
                f'window.onPythonEvent("error", {{"message": "{e}"}})'
            )

    def on_closed():
        """Called when the window is closed."""
        nonlocal log_watcher

        print("Window closed, cleaning up...")

        if log_watcher:
            log_watcher.stop()

    # Connect event handlers
    window.events.loaded += on_loaded
    window.events.closed += on_closed

    # Start the GUI
    print("Starting GUI...")
    webview.start(debug=False)

    print("Application exited")


if __name__ == '__main__':
    main()
