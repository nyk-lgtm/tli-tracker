"""
Overlay window support using win32 APIs.

Provides click-through control for Qt overlay windows.
"""

import sys
from typing import Optional

# Only import win32 modules on Windows
HAS_WIN32 = False
if sys.platform == "win32":
    try:
        import win32gui
        import win32con

        HAS_WIN32 = True
    except ImportError:
        print("Warning: win32 modules not available, overlay features disabled")


def set_click_through(hwnd: int, enabled: bool) -> bool:
    """
    Enable or disable click-through on a window.

    When enabled, mouse clicks pass through to windows below.

    Args:
        hwnd: Window handle (from Qt's winId())
        enabled: True to enable click-through

    Returns:
        True if successful, False otherwise
    """
    if not HAS_WIN32:
        return False

    try:
        style = win32gui.GetWindowLong(hwnd, win32con.GWL_EXSTYLE)

        if enabled:
            style |= win32con.WS_EX_TRANSPARENT
        else:
            style &= ~win32con.WS_EX_TRANSPARENT

        win32gui.SetWindowLong(hwnd, win32con.GWL_EXSTYLE, style)
        return True

    except Exception as e:
        print(f"Failed to set click-through: {e}")
        return False


def get_window_position(hwnd: int) -> Optional[tuple]:
    """Get the current position of a window."""
    if not HAS_WIN32:
        return None

    try:
        rect = win32gui.GetWindowRect(hwnd)
        return (rect[0], rect[1])
    except Exception:
        return None


def set_window_position(hwnd: int, x: int, y: int) -> bool:
    """Set the position of a window."""
    if not HAS_WIN32:
        return False

    try:
        win32gui.SetWindowPos(
            hwnd, 0, x, y, 0, 0, win32con.SWP_NOSIZE | win32con.SWP_NOZORDER
        )
        return True
    except Exception:
        return False
