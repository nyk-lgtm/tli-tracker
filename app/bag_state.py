"""
Bag state tracking for inventory management.

Tracks the player's inventory state and detects changes
(items gained or consumed) between snapshots.
"""

from .log_parser import BagModifyEvent


class BagState:
    """
    Tracks inventory state and detects item changes.

    Uses a two-level tracking approach:
    1. Per-slot tracking: "page:slot:item_id" -> quantity
    2. Baseline totals: "item_id" -> total quantity at last reset

    This handles cases where items stack differently or move between slots.
    """

    def __init__(self):
        # Per-slot state: "page:slot:item_id" -> quantity
        self.slots: dict[str, int] = {}

        # Baseline totals by item_id (set on map enter or initialization)
        self.baseline: dict[str, int] = {}

        # Whether we have a valid inventory snapshot
        self.initialized: bool = False

    def initialize(self, items: list[BagModifyEvent]) -> int:
        """
        Initialize bag state from InitBagData entries.

        Called when the user sorts their bag, which triggers
        a full inventory dump in the game logs.

        Args:
            items: List of BagModifyEvent from InitBagData entries

        Returns:
            Number of unique item types initialized
        """
        self.slots.clear()
        self.baseline.clear()

        for item in items:
            slot_key = f"{item.page_id}:{item.slot_id}:{item.item_id}"
            self.slots[slot_key] = item.quantity

            # Sum by item_id for baseline
            self.baseline[item.item_id] = (
                self.baseline.get(item.item_id, 0) + item.quantity
            )

        self.initialized = True
        return len(self.baseline)

    def reset_baseline(self) -> None:
        """
        Reset baseline to current inventory state.

        Called when entering a new map to establish a fresh
        starting point for tracking drops in that map.
        """
        self.baseline.clear()

        for slot_key, quantity in self.slots.items():
            item_id = slot_key.split(":")[2]
            self.baseline[item_id] = self.baseline.get(item_id, 0) + quantity

    def get_baseline_copy(self) -> dict[str, int]:
        """Get a copy of current baseline for comparison."""
        return self.baseline.copy()

    def process_modifications(self, mods: list[BagModifyEvent]) -> dict[str, int]:
        """
        Process bag modifications and return net changes by item.

        Args:
            mods: List of BagModifyEvent from Modfy entries

        Returns:
            Dictionary of item_id -> net change (positive = gained, negative = consumed)
        """
        if not self.initialized:
            return {}

        # Update slot states
        for mod in mods:
            slot_key = f"{mod.page_id}:{mod.slot_id}:{mod.item_id}"
            self.slots[slot_key] = mod.quantity

        # Calculate current totals by item
        current_totals: dict[str, int] = {}
        for slot_key, quantity in self.slots.items():
            item_id = slot_key.split(":")[2]
            current_totals[item_id] = current_totals.get(item_id, 0) + quantity

        # Compare to baseline and find changes
        changes: dict[str, int] = {}
        all_item_ids = set(current_totals.keys()) | set(self.baseline.keys())

        for item_id in all_item_ids:
            current = current_totals.get(item_id, 0)
            baseline = self.baseline.get(item_id, 0)
            diff = current - baseline

            if diff != 0:
                changes[item_id] = diff
                # Update baseline to prevent double-counting
                self.baseline[item_id] = current

        return changes

    def get_item_count(self, item_id: str) -> int:
        """Get current total count for an item."""
        total = 0
        for slot_key, quantity in self.slots.items():
            if slot_key.endswith(f":{item_id}"):
                total += quantity
        return total

    def get_all_items(self) -> dict[str, int]:
        """Get current totals for all items."""
        totals: dict[str, int] = {}
        for slot_key, quantity in self.slots.items():
            item_id = slot_key.split(":")[2]
            totals[item_id] = totals.get(item_id, 0) + quantity
        return totals

    def clear(self) -> None:
        """Clear all state."""
        self.slots.clear()
        self.baseline.clear()
        self.initialized = False
