"""
Global hotkey support using Win32 RegisterHotKey with a message pump thread.

Provides system-wide hotkey registration that works even when
games are focused, since RegisterHotKey intercepts at the OS level.
"""

import sys
import threading
from typing import Callable, Optional

from PySide6.QtCore import QObject, Signal

# Only import win32 modules on Windows
HAS_WIN32 = False
if sys.platform == "win32":
    try:
        import ctypes
        from ctypes import wintypes

        HAS_WIN32 = True
    except ImportError:
        print("Warning: ctypes not available, hotkeys disabled")

# Virtual key codes
VK_CODES = {
    "F1": 0x70,
    "F2": 0x71,
    "F3": 0x72,
    "F4": 0x73,
    "F5": 0x74,
    "F6": 0x75,
    "F7": 0x76,
    "F8": 0x77,
    "F9": 0x78,
    "F10": 0x79,
    "F11": 0x7A,
    "F12": 0x7B,
    "ESCAPE": 0x1B,
    "ESC": 0x1B,
}

# Modifier flags for RegisterHotKey
MOD_ALT = 0x0001
MOD_CONTROL = 0x0002
MOD_SHIFT = 0x0004
MOD_NOREPEAT = 0x4000  # Prevent repeat when held

WM_HOTKEY = 0x0312


def parse_hotkey(hotkey_str: str) -> tuple[int, int]:
    """
    Parse a hotkey string like "Ctrl+F9" into modifiers and VK code.

    Returns:
        (modifiers, vk_code) for RegisterHotKey
    """
    parts = [p.strip().upper() for p in hotkey_str.split("+")]
    modifiers = MOD_NOREPEAT  # Always prevent key repeat
    vk_code = 0

    for part in parts:
        if part in ("CTRL", "CONTROL"):
            modifiers |= MOD_CONTROL
        elif part in ("ALT", "MENU"):
            modifiers |= MOD_ALT
        elif part in ("SHIFT",):
            modifiers |= MOD_SHIFT
        elif part in VK_CODES:
            vk_code = VK_CODES[part]

    return modifiers, vk_code


class HotkeySignals(QObject):
    """Qt signals for hotkey events (thread-safe communication)."""

    triggered = Signal(int)  # hotkey_id


class HotkeyManager:
    """
    Manages global hotkeys using RegisterHotKey with a dedicated message thread.

    This approach works even when games are focused because RegisterHotKey
    intercepts keys at the Windows OS level.
    """

    def __init__(self):
        self._hotkeys: dict[int, Callable] = {}  # id -> callback
        self._next_id = 1
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._thread_id: Optional[int] = None

        # Qt signals for thread-safe callback invocation
        self._signals = HotkeySignals()
        self._signals.triggered.connect(self._on_hotkey_triggered)

    def register(self, hotkey_str: str, callback: Callable) -> bool:
        """
        Register a global hotkey.

        Args:
            hotkey_str: Key combo (e.g., "F9", "Ctrl+F9")
            callback: Function to call when hotkey is pressed

        Returns:
            True if registration succeeded
        """
        if not HAS_WIN32:
            return False

        modifiers, vk_code = parse_hotkey(hotkey_str)
        if vk_code == 0:
            print(f"[Hotkey] Invalid hotkey: {hotkey_str}")
            return False

        hotkey_id = self._next_id
        self._next_id += 1

        # Store callback
        self._hotkeys[hotkey_id] = callback

        # If thread is running, register via PostThreadMessage
        if self._thread_id:
            # Send registration request to the hotkey thread
            # We'll handle this by storing pending registrations
            self._pending_registrations.append((hotkey_id, modifiers, vk_code))
        else:
            # Store for later when thread starts
            if not hasattr(self, "_pending_registrations"):
                self._pending_registrations = []
            self._pending_registrations.append((hotkey_id, modifiers, vk_code))

        print(f"[Hotkey] Queued {hotkey_str} (id={hotkey_id})")
        return True

    def start(self) -> None:
        """Start the hotkey listener thread."""
        if not HAS_WIN32:
            return

        if self._thread is not None:
            return

        if not hasattr(self, "_pending_registrations"):
            self._pending_registrations = []

        self._running = True
        self._thread = threading.Thread(target=self._message_loop, daemon=True)
        self._thread.start()
        print("[Hotkey] Thread started")

    def stop(self) -> None:
        """Stop the hotkey listener thread."""
        self._running = False

        # Post quit message to thread
        if self._thread_id and HAS_WIN32:
            WM_QUIT = 0x0012
            ctypes.windll.user32.PostThreadMessageW(self._thread_id, WM_QUIT, 0, 0)

        if self._thread:
            self._thread.join(timeout=1.0)
            self._thread = None
            self._thread_id = None

    def _message_loop(self) -> None:
        """Message pump running in dedicated thread."""
        if not HAS_WIN32:
            return

        # Get this thread's ID
        self._thread_id = ctypes.windll.kernel32.GetCurrentThreadId()

        # Register all pending hotkeys
        for hotkey_id, modifiers, vk_code in self._pending_registrations:
            result = ctypes.windll.user32.RegisterHotKey(
                None, hotkey_id, modifiers, vk_code
            )
            if result:
                print(f"[Hotkey] Registered id={hotkey_id}")
            else:
                error = ctypes.GetLastError()
                print(f"[Hotkey] Failed to register id={hotkey_id}, error={error}")

        self._pending_registrations.clear()

        # Message loop
        msg = wintypes.MSG()
        while self._running:
            # GetMessage blocks until a message is available
            # Use PeekMessage with a timeout instead for cleaner shutdown
            result = ctypes.windll.user32.PeekMessageW(
                ctypes.byref(msg),
                None,
                0,
                0,
                1,  # PM_REMOVE
            )

            if result:
                if msg.message == WM_HOTKEY:
                    hotkey_id = msg.wParam
                    # Emit signal to invoke callback on main thread
                    self._signals.triggered.emit(hotkey_id)
                elif msg.message == 0x0012:  # WM_QUIT
                    break

            # Small sleep to prevent busy-waiting
            import time

            time.sleep(0.01)

        # Unregister all hotkeys
        for hotkey_id in self._hotkeys:
            ctypes.windll.user32.UnregisterHotKey(None, hotkey_id)

        print("[Hotkey] Thread stopped")

    def _on_hotkey_triggered(self, hotkey_id: int) -> None:
        """Called on main thread when hotkey is pressed."""
        callback = self._hotkeys.get(hotkey_id)
        if callback:
            callback()


# Global instance
hotkey_manager = HotkeyManager()
