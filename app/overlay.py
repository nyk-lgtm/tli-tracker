"""
Overlay window support using win32 APIs.

Provides functions to make pywebview windows into
transparent, click-through overlays.
"""

import ctypes
from typing import Optional

# Only import win32 modules on Windows
try:
    import win32gui
    import win32con
    import win32api
    HAS_WIN32 = True
except ImportError:
    HAS_WIN32 = False
    print("Warning: win32 modules not available, overlay features disabled")


# Window style constants
GWL_EXSTYLE = -20
WS_EX_LAYERED = 0x00080000
WS_EX_TRANSPARENT = 0x00000020
WS_EX_TOPMOST = 0x00000008
LWA_ALPHA = 0x00000002


def make_overlay(hwnd: int, opacity: float = 0.9, click_through: bool = True) -> bool:
    """
    Transform a window into a transparent overlay.

    Args:
        hwnd: Window handle (from pywebview's native_handle)
        opacity: Window opacity (0.0 to 1.0)
        click_through: If True, clicks pass through to windows below

    Returns:
        True if successful, False otherwise
    """
    if not HAS_WIN32:
        return False

    try:
        # Get current extended style
        style = win32gui.GetWindowLong(hwnd, win32con.GWL_EXSTYLE)

        # Add layered window style (required for transparency)
        style |= win32con.WS_EX_LAYERED

        # Add topmost style
        style |= win32con.WS_EX_TOPMOST

        # Optionally add click-through
        if click_through:
            style |= win32con.WS_EX_TRANSPARENT

        # Apply the style
        win32gui.SetWindowLong(hwnd, win32con.GWL_EXSTYLE, style)

        # Set the transparency level (0-255)
        alpha = int(opacity * 255)
        alpha = max(0, min(255, alpha))  # Clamp to valid range

        win32gui.SetLayeredWindowAttributes(
            hwnd,
            0,  # Color key (not used with LWA_ALPHA)
            alpha,
            win32con.LWA_ALPHA
        )

        # Ensure window is topmost
        win32gui.SetWindowPos(
            hwnd,
            win32con.HWND_TOPMOST,
            0, 0, 0, 0,
            win32con.SWP_NOMOVE | win32con.SWP_NOSIZE
        )

        return True

    except Exception as e:
        print(f"Failed to make overlay: {e}")
        return False


def remove_overlay(hwnd: int) -> bool:
    """
    Remove overlay properties from a window.

    Restores the window to normal behavior.
    """
    if not HAS_WIN32:
        return False

    try:
        # Get current style
        style = win32gui.GetWindowLong(hwnd, win32con.GWL_EXSTYLE)

        # Remove overlay-related styles
        style &= ~win32con.WS_EX_LAYERED
        style &= ~win32con.WS_EX_TRANSPARENT
        style &= ~win32con.WS_EX_TOPMOST

        # Apply the style
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


def set_overlay_opacity(hwnd: int, opacity: float) -> bool:
    """
    Set the opacity of an overlay window.

    Args:
        hwnd: Window handle
        opacity: Opacity value (0.0 to 1.0)
    """
    if not HAS_WIN32:
        return False

    try:
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


def set_click_through(hwnd: int, enabled: bool) -> bool:
    """
    Enable or disable click-through on an overlay.

    When enabled, mouse clicks pass through to windows below.
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


def get_window_position(hwnd: int) -> Optional[tuple[int, int]]:
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
