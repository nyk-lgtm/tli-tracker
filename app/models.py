"""
Data models for TLI Tracker.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from enum import Enum


class DisplayMode(Enum):
    """Display mode for the UI."""

    VALUE = "value"  # Show gold values
    ITEMS = "items"  # Show item quantities


@dataclass
class Item:
    """Game item definition."""

    id: str
    name: str
    type: str  # "Currency", "Compass", "Ashes", etc.


@dataclass
class Price:
    """Price entry for an item."""

    item_id: str
    value: float
    updated_at: datetime


@dataclass
class Drop:
    """A single drop/consumption event."""

    item_id: str
    quantity: int  # positive = gained, negative = consumed
    timestamp: datetime
    value: Optional[float] = None  # calculated value if price known

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "item_id": self.item_id,
            "quantity": self.quantity,
            "timestamp": self.timestamp.isoformat(),
            "value": self.value,
        }


@dataclass
class MapRun:
    """A single map run."""

    started_at: datetime
    ended_at: Optional[datetime] = None
    drops: list[Drop] = field(default_factory=list)
    is_league_zone: bool = False
    investment: float = 0  # FE cost for this map (captured at map end)

    @property
    def duration_seconds(self) -> float:
        """Get duration in seconds."""
        if not self.ended_at:
            return (datetime.now() - self.started_at).total_seconds()
        return (self.ended_at - self.started_at).total_seconds()

    @property
    def total_value(self) -> float:
        """Sum of all drop values."""
        return sum(d.value or 0 for d in self.drops)

    @property
    def total_items(self) -> int:
        """Count of items gained (positive quantities only)."""
        return sum(d.quantity for d in self.drops if d.quantity > 0)

    @property
    def net_value(self) -> float:
        """Total value minus investment."""
        return self.total_value - self.investment

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "started_at": self.started_at.isoformat(),
            "ended_at": self.ended_at.isoformat() if self.ended_at else None,
            "duration_seconds": self.duration_seconds,
            "total_value": self.total_value,
            "investment": self.investment,
            "net_value": self.net_value,
            "total_items": self.total_items,
            "drops": [d.to_dict() for d in self.drops],
            "is_league_zone": self.is_league_zone,
        }


@dataclass
class Session:
    """A farming session containing multiple map runs."""

    id: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    maps: list[MapRun] = field(default_factory=list)

    @property
    def total_value(self) -> float:
        """Sum of gross value from all maps (before investment)."""
        return sum(m.total_value for m in self.maps)

    @property
    def total_investment(self) -> float:
        """Sum of investment from all maps."""
        return sum(m.investment for m in self.maps)

    @property
    def net_value(self) -> float:
        """Total value minus total investment."""
        return self.total_value - self.total_investment

    @property
    def total_items(self) -> int:
        """Sum of items from all maps."""
        return sum(m.total_items for m in self.maps)

    @property
    def total_duration(self) -> float:
        """Total time spent in maps (seconds)."""
        return sum(m.duration_seconds for m in self.maps)

    @property
    def session_duration(self) -> float:
        """Total elapsed time since session started (seconds)."""
        if self.ended_at:
            return (self.ended_at - self.started_at).total_seconds()
        return (datetime.now() - self.started_at).total_seconds()

    @property
    def map_count(self) -> int:
        """Number of completed maps (excludes league zones)."""
        return len([m for m in self.maps if m.ended_at and not m.is_league_zone])

    @property
    def value_per_hour(self) -> float:
        """Net value earned per hour (real-time)."""
        hours = self.session_duration / 3600
        return self.net_value / hours if hours > 0 else 0

    @property
    def maps_per_hour(self) -> float:
        """Maps completed per hour (real-time)."""
        hours = self.session_duration / 3600
        return self.map_count / hours if hours > 0 else 0

    @property
    def all_drops(self) -> list[Drop]:
        """Get all drops from all maps in this session."""
        drops = []
        for map_run in self.maps:
            drops.extend(map_run.drops)
        # Include drops from current map if it exists and hasn't ended
        return drops

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "id": self.id,
            "started_at": self.started_at.isoformat(),
            "ended_at": self.ended_at.isoformat() if self.ended_at else None,
            "total_value": self.total_value,
            "total_investment": self.total_investment,
            "net_value": self.net_value,
            "total_items": self.total_items,
            "total_duration": self.total_duration,
            "session_duration": self.session_duration,
            "map_count": self.map_count,
            "value_per_hour": self.value_per_hour,
            "maps_per_hour": self.maps_per_hour,
            "maps": [m.to_dict() for m in self.maps],
        }

    def to_summary_dict(self) -> dict:
        """Convert to summary dictionary (excludes heavy map data)."""
        return {
            "id": self.id,
            "started_at": self.started_at.isoformat(),
            "ended_at": self.ended_at.isoformat() if self.ended_at else None,
            "total_value": self.total_value,
            "total_investment": self.total_investment,
            "net_value": self.net_value,
            "total_items": self.total_items,
            "total_duration": self.total_duration,
            "session_duration": self.session_duration,
            "map_count": self.map_count,
            "value_per_hour": self.value_per_hour,
            "maps_per_hour": self.maps_per_hour,
        }


@dataclass
class TrackerState:
    """Current state of the tracker."""

    is_initialized: bool = False
    is_in_map: bool = False
    current_map: Optional[MapRun] = None
    current_session: Optional[Session] = None
    display_mode: DisplayMode = DisplayMode.VALUE
