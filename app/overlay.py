"""
Overlay window support using win32 APIs.

Provides functions for click-through and opacity control
on Qt overlay windows.
"""

import sys
from typing import Optional

# Only import win32 modules on Windows
HAS_WIN32 = False
if sys.platform == 'win32':
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


def set_overlay_opacity(hwnd: int, opacity: float) -> bool:
    """
    Set opacity using Win32 layered window.

    Note: Qt's setWindowOpacity() is preferred. Use this only if needed.

    Args:
        hwnd: Window handle
        opacity: Opacity value (0.0 to 1.0)

    Returns:
        True if successful, False otherwise
    """
    if not HAS_WIN32:
        return False

    try:
        # Ensure layered style is set
        style = win32gui.GetWindowLong(hwnd, win32con.GWL_EXSTYLE)
        if not (style & win32con.WS_EX_LAYERED):
            style |= win32con.WS_EX_LAYERED
            win32gui.SetWindowLong(hwnd, win32con.GWL_EXSTYLE, style)

        alpha = int(opacity * 255)
        alpha = max(0, min(255, alpha))

        win32gui.SetLayeredWindowAttributes(
            hwnd,
            0,
            alpha,
            win32con.LWA_ALPHA
        )
        return True

    except Exception as e:
        print(f"Failed to set opacity: {e}")
        return False


def ensure_topmost(hwnd: int) -> bool:
    """
    Ensure window stays on top.

    Note: Qt's WindowStaysOnTopHint should handle this, but this
    can be used as a fallback.
    """
    if not HAS_WIN32:
        return False

    try:
        win32gui.SetWindowPos(
            hwnd,
            win32con.HWND_TOPMOST,
            0, 0, 0, 0,
            win32con.SWP_NOMOVE | win32con.SWP_NOSIZE
        )
        return True
    except Exception as e:
        print(f"Failed to set topmost: {e}")
        return False


def make_overlay(hwnd: int, opacity: float = 0.9, click_through: bool = True) -> bool:
    """
    Apply overlay properties to a window.

    For Qt windows, prefer using Qt's native methods:
    - setWindowOpacity() for opacity
    - WindowStaysOnTopHint flag for topmost

    This function is kept for any edge cases.
    """
    if not HAS_WIN32:
        return False

    success = True
    if click_through:
        success = set_click_through(hwnd, True) and success
    success = set_overlay_opacity(hwnd, opacity) and success
    success = ensure_topmost(hwnd) and success
    return success


def remove_overlay(hwnd: int) -> bool:
    """
    Remove overlay properties from a window.

    Restores the window to normal behavior.
    """
    if not HAS_WIN32:
        return False

    try:
        style = win32gui.GetWindowLong(hwnd, win32con.GWL_EXSTYLE)

        # Remove overlay-related styles
        style &= ~win32con.WS_EX_LAYERED
        style &= ~win32con.WS_EX_TRANSPARENT
        style &= ~win32con.WS_EX_TOPMOST

        win32gui.SetWindowLong(hwnd, win32con.GWL_EXSTYLE, style)

        # Remove topmost
        win32gui.SetWindowPos(
            hwnd,
            win32con.HWND_NOTOPMOST,
            0, 0, 0, 0,
            win32con.SWP_NOMOVE | win32con.SWP_NOSIZE
        )

        return True

    except Exception as e:
        print(f"Failed to remove overlay: {e}")
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
            hwnd,
            0,
            x, y,
            0, 0,
            win32con.SWP_NOSIZE | win32con.SWP_NOZORDER
        )
        return True
    except Exception:
        return False
