"""
JSON file storage utilities.

Handles reading/writing configuration, prices, sessions, and item data.
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from app.widget_registry import get_default_widgets


def is_frozen():
    """Check if running as a compiled EXE"""
    return getattr(sys, "frozen", False) or "__compiled__" in globals()


def get_app_dir() -> Path:
    """Returns the folder where the .exe is located (for saving data)"""
    if is_frozen():
        return Path(sys.executable).parent
    return Path(__file__).parent.parent


def get_resource_path(relative_path: str) -> Path:
    """Returns the path to internal assets (read-only) inside the exe"""
    if getattr(sys, "frozen", False):
        base_path = Path(sys._MEIPASS)
    elif "__compiled__" in globals():
        base_path = Path(os.path.dirname(__file__)).absolute().parent
    else:
        base_path = Path(__file__).parent.parent
    return base_path / relative_path


# Default data directory (relative to app)
DATA_DIR = get_app_dir() / "data"
ITEMS_FILE = get_resource_path("data/item_ids.json")  # Points to internal file


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
        with open(filepath, "r", encoding="utf-8") as f:
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
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False, default=str)
        return True
    except IOError:
        return False


# === Configuration ===

DEFAULT_CONFIG = {
    "display_mode": "value",
    "overlay_opacity": 0.9,
    "tax_enabled": False,
    "tax_rate": 0.125,  # 12.5% AH fee
    "show_map_value": False,  # Show current map value
    "efficiency_per_map": False,  # False = FE/hr, True = FE/map
    "investment_per_map": 0,  # FE cost per map (deducted from values)
    # Game log path
    "game_log_path": "",  # manual override for UE_game.log location
    "cached_log_path": "",  # auto-cached from last successful detection
    "cloud_prices_enabled": False,  # opt-in cloud price fallback
    # Widget-based overlay
    "overlay_edit_mode_hotkey": "Ctrl+F9",  # Hotkey to toggle edit mode
    "widgets": [],  # Widget instances (populated on first load if empty)
}

CONFIG_FILE = "config.json"
_config_load_error: Exception | None = None


def _build_backup_path(filepath: Path, label: str) -> Path:
    """Build a unique sibling backup path for an unreadable data file."""
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    candidate = filepath.with_name(f"{filepath.name}.{label}.{timestamp}")
    counter = 1
    while candidate.exists():
        candidate = filepath.with_name(f"{filepath.name}.{label}.{timestamp}-{counter}")
        counter += 1
    return candidate


def preserve_unreadable_file(filepath: Path, label: str = "corrupt") -> Path | None:
    """Rename an unreadable file aside so a fresh replacement can be written."""
    try:
        backup_path = _build_backup_path(filepath, label)
        filepath.replace(backup_path)
        print(f"[Storage] Preserved unreadable file as {backup_path.name}")
        return backup_path
    except OSError as e:
        print(f"[Storage] Failed to preserve unreadable file: {e}")
        return None


def get_config_load_error() -> Exception | None:
    """Return the most recent config load error, if any."""
    return _config_load_error


def build_default_config() -> dict[str, Any]:
    """Build the canonical default config used for new/reset installs."""
    config = dict(DEFAULT_CONFIG)
    config["widgets"] = get_default_widgets()
    return config


def load_config() -> dict:
    """
    Load application configuration.

    Automatically migrates config by:
    - Adding new keys from DEFAULT_CONFIG
    - Populating widgets array with defaults if empty
    - Saving back if any changes were made and the source file was readable
    """
    global _config_load_error
    filepath = ensure_data_dir() / CONFIG_FILE
    changed = False
    load_failed = False

    if not filepath.exists():
        config: dict[str, Any] = {}
        _config_load_error = None
    else:
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                raw_config = json.load(f)
            if not isinstance(raw_config, dict):
                raise ValueError(
                    "config.json must contain a JSON object at the top level"
                )
            config = raw_config
            _config_load_error = None
        except (json.JSONDecodeError, PermissionError, OSError, ValueError) as e:
            print(f"[Storage] Failed to load config: {e}")
            _config_load_error = e
            config = {}
            load_failed = True

    defaults = build_default_config()

    # Add missing keys from defaults
    for key, value in defaults.items():
        if key not in config:
            config[key] = value
            changed = True

    if not config.get("widgets"):
        config["widgets"] = defaults["widgets"]
        changed = True
    else:
        # ensure all registered widgets exist (re-add any that were lost)
        existing_ids = {w["id"] for w in config["widgets"]}
        for default_widget in defaults["widgets"]:
            if default_widget["id"] not in existing_ids:
                config["widgets"].append(default_widget)
                changed = True

    # Save migrated config
    if changed and not load_failed:
        save_config(config)

    return config


def save_config(config: dict) -> bool:
    """Save application configuration."""
    global _config_load_error
    filepath = ensure_data_dir() / CONFIG_FILE

    if _config_load_error is not None and filepath.exists():
        if preserve_unreadable_file(filepath) is None:
            return False

    success = save_json(CONFIG_FILE, config)
    if success:
        _config_load_error = None
    return success


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

# Item data structure: {"name": str, "type": str}
ItemData = dict[str, str]

# Cache for items to avoid repeated file reads
_item_cache: dict[str, ItemData] | None = None
_items_load_error: Exception | None = None


def load_items() -> dict[str, ItemData]:
    global _item_cache, _items_load_error
    if _item_cache is None:
        try:
            with open(ITEMS_FILE, "r", encoding="utf-8") as f:
                _item_cache = json.load(f)
            _items_load_error = None
        except (FileNotFoundError, PermissionError, OSError, json.JSONDecodeError) as e:
            # keep app running with empty db; UI layer surfaces a one-time warning
            print(f"[Storage] Failed to load item database: {e}")
            _items_load_error = e
            _item_cache = {}
    return _item_cache


def get_items_load_error() -> Exception | None:
    return _items_load_error


def reload_items() -> dict[str, ItemData]:
    """Force reload the item database (clears cache)."""
    global _item_cache, _items_load_error
    _item_cache = None
    _items_load_error = None
    return load_items()


def get_item_name(item_id: str) -> str:
    """Get item name by ID, or return 'Unknown (ID)' if not found."""
    items = load_items()
    item = items.get(str(item_id))
    if item:
        return item["name"]
    return f"Unknown ({item_id})"


def get_item_type(item_id: str) -> str | None:
    """Get item type/category by ID, or return None if not found."""
    items = load_items()
    item = items.get(str(item_id))
    if item:
        return item.get("type")
    return None


# === Datetime Helpers ===


def datetime_to_str(dt: datetime) -> str:
    """Convert datetime to ISO format string."""
    return dt.isoformat()


def str_to_datetime(s: str) -> datetime:
    """Parse ISO format string to datetime."""
    return datetime.fromisoformat(s)
