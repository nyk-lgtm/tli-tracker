"""
Log file watcher using watchdog.

Efficiently monitors the game log file for changes and
invokes a callback with new content.
"""

import threading
from pathlib import Path
from typing import Callable, Optional

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileModifiedEvent


class LogFileHandler(FileSystemEventHandler):
    """Handles file modification events for the log file."""

    def __init__(self, log_path: Path, callback: Callable[[str], None]):
        self.log_path = log_path
        self.callback = callback
        self.file_position = 0
        self._lock = threading.Lock()

        # Initialize position to end of file
        if log_path.exists():
            self.file_position = log_path.stat().st_size

    def on_modified(self, event: FileModifiedEvent) -> None:
        """Called when the watched file is modified."""
        if not isinstance(event, FileModifiedEvent):
            return

        # Check if it's our file (watchdog may trigger for directory)
        event_path = Path(event.src_path)
        if event_path.name != self.log_path.name:
            return

        self._read_new_content()

    def _read_new_content(self) -> None:
        """Read and process new content from the log file."""
        with self._lock:
            try:
                with open(self.log_path, 'r', encoding='utf-8', errors='ignore') as f:
                    # Seek to last known position
                    f.seek(self.file_position)

                    # Read new content
                    new_content = f.read()

                    # Update position
                    self.file_position = f.tell()

                    # Invoke callback if there's new content
                    if new_content:
                        self.callback(new_content)

            except (IOError, OSError) as e:
                print(f"Error reading log file: {e}")

    def reset_position(self) -> None:
        """Reset to end of file (skip existing content)."""
        with self._lock:
            if self.log_path.exists():
                self.file_position = self.log_path.stat().st_size


class LogWatcher:
    """
    Watches the game log file for changes.

    Uses watchdog for efficient file system monitoring instead of polling.
    """

    def __init__(self, log_path: str, callback: Callable[[str], None]):
        """
        Initialize the log watcher.

        Args:
            log_path: Path to the game log file
            callback: Function to call with new log content
        """
        self.log_path = Path(log_path)
        self.callback = callback
        self.observer: Optional[Observer] = None
        self.handler: Optional[LogFileHandler] = None
        self._running = False

    def start(self) -> bool:
        """
        Start watching the log file.

        Returns:
            True if started successfully, False otherwise
        """
        if self._running:
            return True

        if not self.log_path.exists():
            print(f"Log file not found: {self.log_path}")
            return False

        try:
            # Create handler
            self.handler = LogFileHandler(self.log_path, self.callback)

            # Create and start observer
            self.observer = Observer()
            self.observer.schedule(
                self.handler,
                str(self.log_path.parent),  # Watch the directory
                recursive=False
            )
            self.observer.start()
            self._running = True

            print(f"Started watching: {self.log_path}")
            return True

        except Exception as e:
            print(f"Failed to start log watcher: {e}")
            return False

    def stop(self) -> None:
        """Stop watching the log file."""
        if self.observer:
            self.observer.stop()
            self.observer.join(timeout=2)
            self.observer = None

        self._running = False
        print("Log watcher stopped")

    def is_running(self) -> bool:
        """Check if the watcher is running."""
        return self._running

    def read_existing(self) -> str:
        """
        Read the entire existing log file content.

        Useful for initialization or catching up.
        """
        try:
            with open(self.log_path, 'r', encoding='utf-8', errors='ignore') as f:
                return f.read()
        except (IOError, OSError):
            return ""

    def reset(self) -> None:
        """Reset to ignore existing content."""
        if self.handler:
            self.handler.reset_position()
