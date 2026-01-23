"""
Monitor detection utilities for overlay positioning.

Detects which monitor the game is running on and provides geometry info.
"""

import sys
from typing import Optional

# Only import win32 modules on Windows
HAS_WIN32 = False
if sys.platform == "win32":
    try:
        import win32api
        import win32gui

        HAS_WIN32 = True
    except ImportError:
        print("Warning: win32 modules not available, monitor detection disabled")


# Game window titles to search for
GAME_TITLES = ["Torchlight: Infinite  ", "Torchlight: Infinite"]


def find_game_window() -> Optional[int]:
    """
    Find the Torchlight: Infinite game window.

    Returns:
        Window handle (hwnd) if found, None otherwise.
    """
    if not HAS_WIN32:
        return None

    for title in GAME_TITLES:
        hwnd = win32gui.FindWindow(None, title)
        if hwnd:
            return hwnd

    return None


def get_monitor_geometry(hmonitor: int) -> Optional[dict]:
    """
    Get the geometry of a specific monitor.

    Args:
        hmonitor: Monitor handle from win32api

    Returns:
        Dict with x, y, width, height or None if failed.
    """
    if not HAS_WIN32:
        return None

    try:
        info = win32api.GetMonitorInfo(hmonitor)
        # info["Monitor"] is (left, top, right, bottom)
        left, top, right, bottom = info["Monitor"]
        return {
            "x": left,
            "y": top,
            "width": right - left,
            "height": bottom - top,
        }
    except Exception as e:
        print(f"Failed to get monitor geometry: {e}")
        return None


def get_game_monitor() -> Optional[dict]:
    """
    Get the monitor geometry where the game window is located.

    Returns:
        Dict with x, y, width, height or None if game not found.
    """
    if not HAS_WIN32:
        return None

    hwnd = find_game_window()
    if not hwnd:
        return None

    try:
        # Get the monitor that contains the game window
        hmonitor = win32api.MonitorFromWindow(hwnd)
        return get_monitor_geometry(hmonitor)
    except Exception as e:
        print(f"Failed to get game monitor: {e}")
        return None


def get_primary_monitor() -> Optional[dict]:
    """
    Get the primary monitor geometry as fallback.

    Returns:
        Dict with x, y, width, height or None if failed.
    """
    if not HAS_WIN32:
        return None

    try:
        # Get primary monitor dimensions
        width = win32api.GetSystemMetrics(0)  # SM_CXSCREEN
        height = win32api.GetSystemMetrics(1)  # SM_CYSCREEN
        return {
            "x": 0,
            "y": 0,
            "width": width,
            "height": height,
        }
    except Exception as e:
        print(f"Failed to get primary monitor: {e}")
        return None
