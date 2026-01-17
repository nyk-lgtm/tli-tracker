"""
Data models for TLI Tracker.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from enum import Enum


class DisplayMode(Enum):
    """Display mode for the UI."""
    VALUE = "value"      # Show gold values
    ITEMS = "items"      # Show item quantities


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
            "value": self.value
        }


@dataclass
class MapRun:
    """A single map run."""
    started_at: datetime
    ended_at: Optional[datetime] = None
    drops: list[Drop] = field(default_factory=list)

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

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "started_at": self.started_at.isoformat(),
            "ended_at": self.ended_at.isoformat() if self.ended_at else None,
            "duration_seconds": self.duration_seconds,
            "total_value": self.total_value,
            "total_items": self.total_items,
            "drops": [d.to_dict() for d in self.drops]
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
        """Sum of value from all maps."""
        return sum(m.total_value for m in self.maps)

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
        """Number of completed maps."""
        return len([m for m in self.maps if m.ended_at])

    @property
    def value_per_hour(self) -> float:
        """Value earned per hour."""
        hours = self.total_duration / 3600
        return self.total_value / hours if hours > 0 else 0

    @property
    def maps_per_hour(self) -> float:
        """Maps completed per hour."""
        hours = self.total_duration / 3600
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
            "total_items": self.total_items,
            "total_duration": self.total_duration,
            "session_duration": self.session_duration,
            "map_count": self.map_count,
            "value_per_hour": self.value_per_hour,
            "maps_per_hour": self.maps_per_hour,
            "maps": [m.to_dict() for m in self.maps]
        }


@dataclass
class TrackerState:
    """Current state of the tracker."""
    is_initialized: bool = False
    is_in_map: bool = False
    current_map: Optional[MapRun] = None
    current_session: Optional[Session] = None
    display_mode: DisplayMode = DisplayMode.VALUE
