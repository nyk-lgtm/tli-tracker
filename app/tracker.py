"""
Core tracker - the main state machine for drop tracking.

Coordinates log parsing, bag state, price lookups, and session management.
"""

from datetime import datetime
from typing import Callable, Optional, Any
import uuid

from .models import TrackerState, MapRun, Session, Drop, DisplayMode
from .log_parser import LogParser
from .bag_state import BagState
from .price_manager import PriceManager
from .session_manager import SessionManager
from .storage import get_item_name, load_items


class Tracker:
    """
    Core tracking state machine.

    Processes log events and maintains tracking state.
    Notifies the UI of changes via callbacks.
    """

    # Minimum InitBagData entries to consider a valid initialization
    MIN_INIT_ITEMS = 20

    def __init__(
        self,
        price_manager: PriceManager,
        session_manager: SessionManager,
        on_update: Callable[[str, Any], None]
    ):
        """
        Initialize the tracker.

        Args:
            price_manager: PriceManager instance for price lookups
            session_manager: SessionManager instance for session persistence
            on_update: Callback function(event_type, data) to notify UI
        """
        self.state = TrackerState()
        self.bag = BagState()
        self.parser = LogParser()
        self.prices = price_manager
        self.sessions = session_manager
        self.on_update = on_update

        # Track if we're waiting for user to sort bag
        self._awaiting_init = False

    def process_log_chunk(self, text: str) -> None:
        """
        Process a chunk of new log content.

        This is the main entry point called by the LogWatcher.
        """
        # Check for initialization data (bag sort)
        if self._awaiting_init or not self.state.is_initialized:
            init_items = self.parser.parse_bag_init(text)
            if len(init_items) >= self.MIN_INIT_ITEMS:
                count = self.bag.initialize(init_items)
                self.state.is_initialized = True
                self._awaiting_init = False
                self._notify("initialized", {"item_count": count})

        # Check for map changes
        map_event = self.parser.parse_map_change(text)
        if map_event:
            if map_event.entering:
                self._on_map_enter()
            else:
                self._on_map_exit()

        # Process bag modifications (drops/consumption)
        if self.state.is_initialized:
            mods = self.parser.parse_bag_modifications(text)
            if mods:
                changes = self.bag.process_modifications(mods)
                if changes:
                    self._process_drops(changes)

        # Extract price data from AH searches
        price_events = self.parser.parse_price_search(text)
        for event in price_events:
            self.prices.update_from_search(event.item_id, event.prices)
            self._notify("price_update", {
                "item_id": event.item_id,
                "price": event.average_price
            })

    def _on_map_enter(self) -> None:
        """Handle entering a map."""
        self.state.is_in_map = True

        # Reset bag baseline for this map
        self.bag.reset_baseline()

        # Start new map run
        self.state.current_map = MapRun(started_at=datetime.now())

        # Ensure we have a session
        if not self.state.current_session:
            self.state.current_session = self.sessions.create_session()

        self._notify("map_enter", {})
        self._notify_state()

    def _on_map_exit(self) -> None:
        """Handle exiting a map."""
        if self.state.current_map:
            self.state.current_map.ended_at = datetime.now()

            # Add to session
            if self.state.current_session:
                self.state.current_session.maps.append(self.state.current_map)
                self.sessions.save_session(self.state.current_session)

        self.state.is_in_map = False
        self.state.current_map = None

        self._notify("map_exit", {})
        self._notify_state()

    def _process_drops(self, changes: dict[str, int]) -> None:
        """Process detected item changes."""
        if not self.state.current_map:
            # Not in a map, but still track if we have a session
            # This handles edge cases like items gained in hideout
            return

        for item_id, quantity in changes.items():
            # Get item name and skip unknown items (gear, memories, etc.)
            item_name = get_item_name(item_id)
            if item_name.startswith("Unknown ("):
                # Skip items not in the database (gear, memories, slates, etc.)
                continue

            # Get price (with tax if enabled)
            price = self.prices.get_price_with_tax(item_id)
            value = price * quantity if price else None

            # Create drop record
            drop = Drop(
                item_id=item_id,
                quantity=quantity,
                timestamp=datetime.now(),
                value=value
            )

            # Add to current map
            self.state.current_map.drops.append(drop)

            # Notify UI of new drop
            self._notify("drop", {
                "item_id": item_id,
                "item_name": item_name,
                "quantity": quantity,
                "value": value,
                "price_status": self.prices.get_price_status(item_id)
            })

        self._notify_state()

    def _notify(self, event_type: str, data: Any) -> None:
        """Send an event to the UI."""
        try:
            self.on_update(event_type, data)
        except Exception as e:
            print(f"Error in update callback: {e}")

    def _notify_state(self) -> None:
        """Send full state update to UI."""
        self._notify("state", self.get_stats())

    # === Public API ===

    def get_stats(self) -> dict:
        """Get current tracker statistics for UI."""
        current_map = None
        if self.state.current_map:
            current_map = {
                "duration": self.state.current_map.duration_seconds,
                "value": self.state.current_map.total_value,
                "items": self.state.current_map.total_items,
            }

        session = None
        session_drops = []
        if self.state.current_session:
            # Get all drops from the session (completed maps + current map)
            session_drops = [self._drop_to_dict(d) for d in self.state.current_session.all_drops]
            if self.state.current_map:
                # Add current map's drops (not yet in session)
                session_drops.extend([self._drop_to_dict(d) for d in self.state.current_map.drops])

            session = {
                "id": self.state.current_session.id,
                "duration_mapping": self.state.current_session.total_duration,
                "duration_total": self.state.current_session.session_duration,
                "value": self.state.current_session.total_value,
                "items": self.state.current_session.total_items,
                "map_count": self.state.current_session.map_count,
                "value_per_hour": self.state.current_session.value_per_hour,
                "maps_per_hour": self.state.current_session.maps_per_hour,
                "drops": session_drops
            }

        return {
            "initialized": self.state.is_initialized,
            "awaiting_init": self._awaiting_init,
            "in_map": self.state.is_in_map,
            "display_mode": self.state.display_mode.value,
            "current_map": current_map,
            "session": session
        }

    def _drop_to_dict(self, drop: Drop) -> dict:
        """Convert a Drop to a dictionary with item name."""
        return {
            "item_id": drop.item_id,
            "item_name": get_item_name(drop.item_id),
            "quantity": drop.quantity,
            "value": drop.value,
            "timestamp": drop.timestamp.isoformat()
        }

    def request_initialization(self) -> dict:
        """
        Request bag initialization.

        The user should sort their bag in-game after calling this.
        """
        self._awaiting_init = True
        self.bag.clear()
        self.state.is_initialized = False

        return {
            "status": "waiting",
            "message": "Sort your bag in-game to initialize"
        }

    def set_display_mode(self, mode: str) -> None:
        """Set the display mode (value or items)."""
        try:
            self.state.display_mode = DisplayMode(mode)
            self._notify_state()
        except ValueError:
            pass

    def reset_session(self) -> None:
        """Reset the current session."""
        # End current session if exists
        if self.state.current_session:
            self.state.current_session.ended_at = datetime.now()
            self.sessions.save_session(self.state.current_session)

        # Start fresh
        self.state.current_session = None
        self.state.current_map = None
        self.state.is_in_map = False

        self._notify("session_reset", {})
        self._notify_state()

    def reset_all(self) -> None:
        """Reset all tracking state."""
        self.bag.clear()
        self.state = TrackerState()
        self._awaiting_init = False

        self._notify("reset", {})
        self._notify_state()
