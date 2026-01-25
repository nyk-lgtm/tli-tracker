"""
Widget Registry

Defines widget types, their defaults, and constraints for the overlay system.
"""

from typing import TypedDict


class WidgetSize(TypedDict):
    width: int
    height: int


class WidgetPosition(TypedDict):
    x: int
    y: int


class WidgetConfig(TypedDict, total=False):
    """Optional per-widget configuration."""

    pass


class WidgetInstance(TypedDict):
    """A widget instance as stored in config."""

    id: str
    type: str
    enabled: bool
    position: WidgetPosition
    size: WidgetSize
    config: WidgetConfig


class WidgetDefinition(TypedDict):
    """Definition of a widget type."""

    type: str
    label: str
    default_size: WidgetSize
    min_size: WidgetSize
    max_size: WidgetSize
    default_position: WidgetPosition


# Widget type definitions
WIDGET_TYPES: dict[str, WidgetDefinition] = {
    "stats_bar": {
        "type": "stats_bar",
        "label": "Stats Bar",
        "default_size": {"width": 330, "height": 50},
        "min_size": {"width": 250, "height": 40},
        "max_size": {"width": 500, "height": 80},
        "default_position": {"x": 100, "y": 100},
    },
    "pulse_chart": {
        "type": "pulse_chart",
        "label": "Value/Map Chart",
        "default_size": {"width": 160, "height": 120},
        "min_size": {"width": 150, "height": 80},  # 15 bars need ~132px + padding
        "max_size": {"width": 300, "height": 200},
        "default_position": {"x": 100, "y": 160},
    },
    "efficiency_chart": {
        "type": "efficiency_chart",
        "label": "Efficiency Chart",
        "default_size": {"width": 160, "height": 120},
        "min_size": {"width": 140, "height": 80},  # SVG stretches, needs decent width
        "max_size": {"width": 300, "height": 200},
        "default_position": {"x": 270, "y": 160},
    },
    "donut_chart": {
        "type": "donut_chart",
        "label": "Loot Distribution",
        "default_size": {"width": 280, "height": 120},
        "min_size": {
            "width": 220,
            "height": 100,
        },  # 70px ring + legend needs horizontal space
        "max_size": {"width": 400, "height": 200},
        "default_position": {"x": 100, "y": 290},
    },
}


def get_default_widgets() -> list[WidgetInstance]:
    """
    Get the default widget layout for new installations.

    Returns a list of widget instances with default positions and sizes.
    """
    return [
        {
            "id": "widget-stats-bar",
            "type": "stats_bar",
            "enabled": True,
            "position": {"x": 100, "y": 100},
            "size": {"width": 330, "height": 50},
            "config": {},
        },
        {
            "id": "widget-pulse-chart",
            "type": "pulse_chart",
            "enabled": False,  # Charts disabled by default like old overlay
            "position": {"x": 100, "y": 160},
            "size": {"width": 160, "height": 120},
            "config": {},
        },
        {
            "id": "widget-efficiency-chart",
            "type": "efficiency_chart",
            "enabled": False,
            "position": {"x": 270, "y": 160},
            "size": {"width": 160, "height": 120},
            "config": {},
        },
        {
            "id": "widget-donut-chart",
            "type": "donut_chart",
            "enabled": False,
            "position": {"x": 100, "y": 290},
            "size": {"width": 280, "height": 120},
            "config": {},
        },
    ]


def get_widget_definition(widget_type: str) -> WidgetDefinition | None:
    """Get the definition for a widget type."""
    return WIDGET_TYPES.get(widget_type)


def validate_widget_bounds(widget: WidgetInstance) -> WidgetInstance:
    """
    Validate and clamp widget size to min/max bounds.

    Returns the widget with corrected size if needed.
    """
    definition = get_widget_definition(widget["type"])
    if not definition:
        return widget

    # Clamp size to bounds
    size = widget["size"]
    min_size = definition["min_size"]
    max_size = definition["max_size"]

    clamped_size = {
        "width": max(min_size["width"], min(size["width"], max_size["width"])),
        "height": max(min_size["height"], min(size["height"], max_size["height"])),
    }

    if clamped_size != size:
        widget = {**widget, "size": clamped_size}

    return widget
