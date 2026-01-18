"""
JSON file storage utilities.

Handles reading/writing configuration, prices, sessions, and item data.
"""

import json
import os
from pathlib import Path
from typing import Any, Optional
from datetime import datetime


# Default data directory (relative to app)
DATA_DIR = Path(__file__).parent.parent / "data"


def ensure_data_dir() -> Path:
    """Ensure the data directory exists and return its path."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    # Create sessions subdirectory for individual session files
    sessions_dir = DATA_DIR / "sessions"
    sessions_dir.mkdir(exist_ok=True)
    return DATA_DIR


def load_json(filename: str, default: Any = None) -> Any:
    """
    Load JSON data from a file in the data directory.

    Args:
        filename: Name of the JSON file (e.g., "config.json")
        default: Default value if file doesn't exist or is invalid

    Returns:
        Parsed JSON data or default value
    """
    filepath = ensure_data_dir() / filename

    if not filepath.exists():
        return default if default is not None else {}

    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return default if default is not None else {}


def save_json(filename: str, data: Any) -> bool:
    """
    Save data to a JSON file in the data directory.

    Args:
        filename: Name of the JSON file
        data: Data to serialize to JSON

    Returns:
        True if successful, False otherwise
    """
    filepath = ensure_data_dir() / filename

    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False, default=str)
        return True
    except IOError:
        return False


# === Configuration ===

DEFAULT_CONFIG = {
    "display_mode": "value",
    "overlay_opacity": 0.9,
    "overlay_pinned": False,
    "overlay_position": {"x": 100, "y": 100},
    "tax_enabled": False,
    "tax_rate": 0.125,  # 12.5% AH fee
    "show_map_value": False,  # Show current map value
}


def load_config() -> dict:
    """Load application configuration."""
    config = load_json("config.json", DEFAULT_CONFIG.copy())
    # Ensure all default keys exist
    for key, value in DEFAULT_CONFIG.items():
        if key not in config:
            config[key] = value
    return config


def save_config(config: dict) -> bool:
    """Save application configuration."""
    return save_json("config.json", config)


def get_config_value(key: str, default: Any = None) -> Any:
    """Get a single configuration value."""
    config = load_config()
    return config.get(key, default)


def set_config_value(key: str, value: Any) -> bool:
    """Set a single configuration value."""
    config = load_config()
    config[key] = value
    return save_config(config)


# === Items Database ===

# Cache for item names to avoid repeated file reads
_item_cache: dict[str, str] | None = None


def load_items() -> dict[str, str]:
    """
    Load the item database.

    Returns:
        Dictionary of item_id -> item_name
    """
    global _item_cache
    if _item_cache is None:
        _item_cache = load_json("item_ids.json", {})
    return _item_cache


def reload_items() -> dict[str, str]:
    """Force reload the item database (clears cache)."""
    global _item_cache
    _item_cache = None
    return load_items()


def get_item_name(item_id: str) -> str:
    """Get item name by ID, or return 'Unknown (ID)' if not found."""
    items = load_items()
    name = items.get(str(item_id))
    if name:
        return name
    return f"Unknown ({item_id})"


# === Datetime Helpers ===

def datetime_to_str(dt: datetime) -> str:
    """Convert datetime to ISO format string."""
    return dt.isoformat()


def str_to_datetime(s: str) -> datetime:
    """Parse ISO format string to datetime."""
    return datetime.fromisoformat(s)
