"""
Theme manager.

Loads built-in and user-authored color themes, validates them, and resolves
the active theme into a flat CSS-var map that the frontend can apply via
setProperty on :root.

Theme JSON shape (all 10 palette slots required):

    {
      "id": "default",
      "name": "Default",
      "description": "...",
      "builtin": true,                 // optional, set automatically
      "mode": "dark",                  // optional, reserved
      "palette": {
        "bg":         "#0c1220",
        "surface":    "#151e2c",
        "border":     "#2a3441",
        "text":       "#f1f5f9",
        "text-muted": "#94a3b8",
        "primary":    "#0d9488",
        "success":    "#22d3ee",
        "warning":    "#f59e0b",
        "danger":     "#f87171",
        "accent":     "#38bdf8"
      },
      "chart_palette": ["#...", ...],  // optional, must be 9 entries if set
      "overrides": { ... }              // optional --tli-color-* overrides
    }
"""

import json
import re
import threading
from pathlib import Path
from typing import Callable, Optional

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

from .storage import ensure_data_dir, get_resource_path, load_config

PALETTE_SLOTS = (
    "bg",
    "surface",
    "border",
    "text",
    "text-muted",
    "primary",
    "success",
    "warning",
    "danger",
    "accent",
)

CHART_PALETTE_SIZE = 9

_HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")


class ThemeError(ValueError):
    """Raised on invalid theme data."""


def _hex_to_rgb_channel(hex_color: str) -> str:
    """Convert '#rrggbb' to a 'r g b' channel string for CSS rgb(... / a) calls."""
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    if len(h) == 8:
        h = h[:6]  # drop alpha for the rgb channel
    r = int(h[0:2], 16)
    g = int(h[2:4], 16)
    b = int(h[4:6], 16)
    return f"{r} {g} {b}"


def _validate_theme(data: dict, source: Path | str) -> dict:
    """Validate and normalize a parsed theme dict. Returns the canonical form."""
    if not isinstance(data, dict):
        raise ThemeError(f"{source}: theme must be a JSON object")

    theme_id = data.get("id")
    if not isinstance(theme_id, str) or not theme_id:
        raise ThemeError(f"{source}: missing or invalid 'id'")
    if not re.match(r"^[a-z0-9][a-z0-9_-]*$", theme_id):
        raise ThemeError(
            f"{source}: id must be lowercase alphanumeric "
            f"with - or _ (got {theme_id!r})"
        )

    name = data.get("name")
    if not isinstance(name, str) or not name:
        raise ThemeError(f"{source}: missing or invalid 'name'")

    palette = data.get("palette")
    if not isinstance(palette, dict):
        raise ThemeError(f"{source}: 'palette' must be an object")

    missing = [slot for slot in PALETTE_SLOTS if slot not in palette]
    if missing:
        raise ThemeError(f"{source}: palette missing slots: {', '.join(missing)}")

    for slot in PALETTE_SLOTS:
        value = palette[slot]
        if not isinstance(value, str) or not _HEX_RE.match(value):
            raise ThemeError(
                f"{source}: palette[{slot!r}] must be a hex color (got {value!r})"
            )

    chart_palette = data.get("chart_palette")
    if chart_palette is not None:
        if (
            not isinstance(chart_palette, list)
            or len(chart_palette) != CHART_PALETTE_SIZE
        ):
            raise ThemeError(
                f"{source}: chart_palette must be a list of "
                f"{CHART_PALETTE_SIZE} hex colors"
            )
        for i, value in enumerate(chart_palette):
            if not isinstance(value, str) or not _HEX_RE.match(value):
                raise ThemeError(
                    f"{source}: chart_palette[{i}] must be a hex color (got {value!r})"
                )

    overrides = data.get("overrides", {})
    if not isinstance(overrides, dict):
        raise ThemeError(f"{source}: 'overrides' must be an object if present")
    for key in overrides:
        if not isinstance(key, str) or not key.startswith("--tli-"):
            raise ThemeError(
                f"{source}: overrides keys must be CSS var names "
                f"starting with --tli- (got {key!r})"
            )

    mode = data.get("mode", "dark")
    if mode not in ("dark", "light"):
        raise ThemeError(f"{source}: mode must be 'dark' or 'light' (got {mode!r})")

    return {
        "id": theme_id,
        "name": name,
        "description": data.get("description", ""),
        "builtin": bool(data.get("builtin", False)),
        "mode": mode,
        "palette": {slot: palette[slot] for slot in PALETTE_SLOTS},
        "chart_palette": list(chart_palette) if chart_palette else None,
        "overrides": dict(overrides),
    }


class _CustomThemesHandler(FileSystemEventHandler):
    """Watchdog handler that fires the manager's reload callback on changes."""

    def __init__(self, on_change: Callable[[], None]):
        self.on_change = on_change

    def _is_theme_file(self, path: str) -> bool:
        return path.lower().endswith(".json")

    def on_created(self, event: FileSystemEvent) -> None:
        if not event.is_directory and self._is_theme_file(event.src_path):
            self.on_change()

    def on_modified(self, event: FileSystemEvent) -> None:
        if not event.is_directory and self._is_theme_file(event.src_path):
            self.on_change()

    def on_deleted(self, event: FileSystemEvent) -> None:
        if not event.is_directory and self._is_theme_file(event.src_path):
            self.on_change()

    def on_moved(self, event: FileSystemEvent) -> None:
        if not event.is_directory:
            self.on_change()


class ThemeManager:
    """Loads, validates, and serves color themes."""

    def __init__(
        self,
        on_themes_changed: Optional[Callable[[], None]] = None,
    ):
        self.builtin_dir: Path = get_resource_path("data/themes/_builtin")
        self.custom_dir: Path = ensure_data_dir() / "themes" / "custom"
        self.custom_dir.mkdir(parents=True, exist_ok=True)

        self._on_themes_changed = on_themes_changed
        self._lock = threading.Lock()
        self._themes: dict[str, dict] = {}
        self._observer: Optional[Observer] = None

        self._reload()
        self._start_watcher()

    # === Public API ===

    def list_themes(self) -> list[dict]:
        """Return summary metadata for every loaded theme, sorted (builtin first)."""
        with self._lock:
            entries = [
                {
                    "id": t["id"],
                    "name": t["name"],
                    "description": t["description"],
                    "builtin": t["builtin"],
                    "mode": t["mode"],
                }
                for t in self._themes.values()
            ]
        entries.sort(key=lambda e: (not e["builtin"], e["name"].lower()))
        return entries

    def get_theme(self, theme_id: str) -> Optional[dict]:
        """Return the canonical theme dict for `theme_id`, or None."""
        with self._lock:
            theme = self._themes.get(theme_id)
            return dict(theme) if theme else None

    def get_active_theme(self) -> dict:
        """Resolve the active theme from config, falling back to default."""
        config = load_config()
        active_id = config.get("theme", "default")
        theme = self.get_theme(active_id) or self.get_theme("default")
        if theme is None:
            raise ThemeError("default theme is missing - bundle is broken")

        config_overrides = config.get("theme_overrides", {})
        if isinstance(config_overrides, dict) and config_overrides:
            theme = dict(theme)
            theme["overrides"] = {**theme.get("overrides", {}), **config_overrides}
        return theme

    def resolve_css_vars(self, theme: dict) -> dict[str, str]:
        """
        Flatten a theme into a CSS-var map suitable for setProperty on :root.

        Includes hex foundation slots, their RGB-channel mirrors, optional chart
        palette overrides, and any explicit semantic-var overrides.
        """
        css_vars: dict[str, str] = {}

        for slot, hex_value in theme["palette"].items():
            css_vars[f"--tli-palette-{slot}"] = hex_value
            css_vars[f"--tli-palette-{slot}-rgb"] = _hex_to_rgb_channel(hex_value)

        chart_palette = theme.get("chart_palette")
        if chart_palette:
            for i, hex_value in enumerate(chart_palette):
                css_vars[f"--tli-color-chart-{i}"] = hex_value

        for key, value in theme.get("overrides", {}).items():
            css_vars[key] = value

        return css_vars

    def save_custom_theme(self, theme_data: dict) -> dict:
        """Persist a user-authored theme. Returns the canonical form on success."""
        normalized = _validate_theme(theme_data, "<custom theme>")
        normalized["builtin"] = False

        if normalized["id"] in {t["id"] for t in self._themes.values() if t["builtin"]}:
            raise ThemeError(
                f"theme id {normalized['id']!r} collides with a built-in theme"
            )

        path = self.custom_dir / f"{normalized['id']}.json"
        path.write_text(
            json.dumps(_strip_runtime_fields(normalized), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        # watchdog will trigger _reload, but reload synchronously so callers see
        # the new theme immediately
        self._reload()
        self._notify_changed()
        return normalized

    def delete_custom_theme(self, theme_id: str) -> bool:
        """Delete a user-authored theme by id. Built-ins cannot be deleted."""
        with self._lock:
            theme = self._themes.get(theme_id)
        if theme is None:
            return False
        if theme["builtin"]:
            raise ThemeError(f"cannot delete built-in theme {theme_id!r}")

        path = self.custom_dir / f"{theme_id}.json"
        if path.exists():
            path.unlink()
        self._reload()
        self._notify_changed()
        return True

    def import_theme(self, src: Path) -> dict:
        """Load a theme JSON from `src` and copy it into the custom dir."""
        try:
            data = json.loads(Path(src).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            raise ThemeError(f"failed to read theme file: {e}") from e
        return self.save_custom_theme(data)

    def export_theme(self, theme_id: str, dest: Path) -> Path:
        """Write the canonical form of `theme_id` to `dest`."""
        theme = self.get_theme(theme_id)
        if theme is None:
            raise ThemeError(f"unknown theme {theme_id!r}")
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(
            json.dumps(_strip_runtime_fields(theme), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return dest

    def shutdown(self) -> None:
        """Stop the file watcher. Safe to call multiple times."""
        if self._observer is not None:
            try:
                self._observer.stop()
                self._observer.join(timeout=2.0)
            except Exception as e:
                print(f"[ThemeManager] failed to stop watcher: {e}")
            self._observer = None

    # === Internals ===

    def _reload(self) -> None:
        loaded: dict[str, dict] = {}

        builtin_files = (
            sorted(self.builtin_dir.glob("*.json")) if self.builtin_dir.exists() else []
        )
        for path in builtin_files:
            theme = self._load_file(path, builtin=True)
            if theme is not None:
                loaded[theme["id"]] = theme

        for path in sorted(self.custom_dir.glob("*.json")):
            theme = self._load_file(path, builtin=False)
            if theme is None:
                continue
            if theme["id"] in loaded and loaded[theme["id"]]["builtin"]:
                print(
                    f"[ThemeManager] custom theme {theme['id']!r} shadows a built-in; "
                    f"skipping {path.name}"
                )
                continue
            loaded[theme["id"]] = theme

        if "default" not in loaded:
            print("[ThemeManager] WARNING: 'default' theme missing from bundle")

        with self._lock:
            self._themes = loaded

    def _load_file(self, path: Path, *, builtin: bool) -> Optional[dict]:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and "id" not in data:
                data["id"] = path.stem
            data["builtin"] = builtin
            return _validate_theme(data, path)
        except (OSError, json.JSONDecodeError, ThemeError) as e:
            print(f"[ThemeManager] failed to load {path.name}: {e}")
            return None

    def _start_watcher(self) -> None:
        try:
            handler = _CustomThemesHandler(on_change=self._on_custom_change)
            observer = Observer()
            observer.schedule(handler, str(self.custom_dir), recursive=False)
            observer.start()
            self._observer = observer
        except Exception as e:
            print(f"[ThemeManager] failed to start watcher: {e}")

    def _on_custom_change(self) -> None:
        self._reload()
        self._notify_changed()

    def _notify_changed(self) -> None:
        if self._on_themes_changed is None:
            return
        try:
            self._on_themes_changed()
        except Exception as e:
            print(f"[ThemeManager] on_themes_changed callback failed: {e}")


def _strip_runtime_fields(theme: dict) -> dict:
    """Return a copy of `theme` without runtime-only fields, ready for serialization."""
    out = {
        "id": theme["id"],
        "name": theme["name"],
        "description": theme.get("description", ""),
        "mode": theme.get("mode", "dark"),
        "palette": dict(theme["palette"]),
    }
    if theme.get("chart_palette"):
        out["chart_palette"] = list(theme["chart_palette"])
    if theme.get("overrides"):
        out["overrides"] = dict(theme["overrides"])
    return out
