"""
Core tracker - the main state machine for drop tracking.

Coordinates log parsing, bag state, price lookups, and session management.
"""

import time
from datetime import datetime
from typing import Any, Callable

from .bag_state import BagState
from .log_parser import BagModifyEvent, LogParser
from .models import DisplayMode, Drop, MapRun, TrackerState
from .price_manager import PriceManager
from .session_manager import SessionManager
from .storage import get_item_name, get_item_type, load_config


class Tracker:
    """
    Core tracking state machine.

    Processes log events and maintains tracking state.
    Notifies the UI of changes via callbacks.
    """

    # Minimum InitBagData entries to consider a valid initialization
    MIN_INIT_ITEMS = 20
    INIT_BURST_IDLE_SECONDS = 0.35

    def __init__(
        self,
        price_manager: PriceManager,
        session_manager: SessionManager,
        on_update: Callable[[str, Any], None],
        cloud_prices=None,
    ):
        self.state = TrackerState()
        self.bag = BagState()
        self.parser = LogParser()
        self.prices = price_manager
        self.cloud_prices = cloud_prices
        self.sessions = session_manager
        self.on_update = on_update

        # Track if we're waiting for user to sort bag
        self._awaiting_init = False
        self._runtime_config = {}
        self._session_dirty = False
        self._session_persisted = False
        self._pending_init_items: dict[str, BagModifyEvent] = {}
        self._pending_init_old_baseline: dict[str, int] = {}
        self._pending_init_existing_state = False
        self._pending_init_last_seen_at: float | None = None
        self._reset_live_cache(mark_dirty=True)
        self._reset_drop_index(mark_dirty=True)
        self.refresh_runtime_config()

        # Pause state
        self._is_paused = False
        self._pause_started_at: datetime | None = None
        self._paused_live_in_map = False
        self._paused_live_is_league_zone = False
        self._paused_map_transitions = 0

    def _reset_live_cache(self, mark_dirty: bool = False) -> None:
        """Reset cached aggregate state used by the live UI."""
        self._live_items: dict[str, dict] = {}
        self._live_category_totals: dict[str, float] = {}
        self._live_maps: list[dict] = []
        self._live_completed_value = 0.0
        self._live_completed_items = 0
        self._live_completed_duration = 0.0
        self._live_completed_map_count = 0
        self._live_current_value = 0.0
        self._live_current_items = 0
        self._live_dirty = mark_dirty

    def _mark_live_dirty(self) -> None:
        """Mark cached live aggregates as needing a rebuild."""
        self._live_dirty = True

    def _buffer_init_items(self, items: list[BagModifyEvent]) -> None:
        """Accumulate a logical InitBagData burst across watcher chunks."""
        if not self._pending_init_items:
            self._pending_init_old_baseline = self.bag.get_baseline_copy()
            self._pending_init_existing_state = self.state.is_initialized
        for item in items:
            slot_key = f"{item.page_id}:{item.slot_id}"
            self._pending_init_items[slot_key] = item
        self._pending_init_last_seen_at = time.monotonic()

    def _clear_pending_init_buffer(self) -> None:
        """Clear any buffered InitBagData snapshot state."""
        self._pending_init_items = {}
        self._pending_init_old_baseline = {}
        self._pending_init_existing_state = False
        self._pending_init_last_seen_at = None

    def _flush_pending_init_if_idle(self, process_changes: bool) -> bool:
        """Flush buffered InitBagData once the sort burst has gone quiet."""
        if not self._pending_init_items or self._pending_init_last_seen_at is None:
            return False

        idle_for = time.monotonic() - self._pending_init_last_seen_at
        if idle_for < self.INIT_BURST_IDLE_SECONDS:
            return False

        return self._flush_pending_init(process_changes=process_changes)

    def _flush_pending_init(self, process_changes: bool) -> bool:
        """
        Apply a buffered InitBagData burst as one inventory snapshot.

        Returns whether the current chunk should skip Modfy processing because
        a sort re-snapshot already accounted for those changes.
        """
        if not self._pending_init_items:
            return False

        init_items = list(self._pending_init_items.values())
        old_baseline = self._pending_init_old_baseline
        had_existing_state = self._pending_init_existing_state

        self._clear_pending_init_buffer()

        count = self.bag.initialize(init_items)
        skip_modfy = False

        if had_existing_state:
            changes = {}
            for item_id, new_qty in self.bag.baseline.items():
                old_qty = old_baseline.get(item_id, 0)
                diff = new_qty - old_qty
                if diff != 0:
                    changes[item_id] = diff

            for item_id, old_qty in old_baseline.items():
                if item_id not in self.bag.baseline:
                    changes[item_id] = -old_qty

            if process_changes and changes:
                self._process_drops(changes)
            skip_modfy = process_changes
        else:
            self.state.is_initialized = True

        self._awaiting_init = False
        self._notify("initialized", {"item_count": count})
        return skip_modfy

    def _reset_drop_index(self, mark_dirty: bool = False) -> None:
        """Reset cached drop lookups used by repricing paths."""
        self._drop_index: dict[str, list[Drop]] = {}
        self._drop_index_dirty = mark_dirty

    def _mark_drop_index_dirty(self) -> None:
        """Mark cached drop lookups as needing a rebuild."""
        self._drop_index_dirty = True

    def _ensure_drop_index(self) -> None:
        """Rebuild the per-item drop index if it is stale."""
        if self._drop_index_dirty:
            self._rebuild_drop_index()

    def _rebuild_drop_index(self) -> None:
        """Rebuild the per-item drop index from session state."""
        self._reset_drop_index(mark_dirty=False)

        session = self.state.current_session
        if session:
            for map_run in session.maps:
                for drop in map_run.drops:
                    self._index_drop(drop)

        if self.state.current_map and (
            not session
            or not session.maps
            or session.maps[-1] is not self.state.current_map
        ):
            for drop in self.state.current_map.drops:
                self._index_drop(drop)

    def _index_drop(self, drop: Drop) -> None:
        """Add a drop reference to the per-item index."""
        if self._drop_index_dirty:
            return
        self._drop_index.setdefault(drop.item_id, []).append(drop)

    def refresh_runtime_config(self) -> None:
        """Refresh the small config snapshot used in tight loops."""
        config = load_config()
        self._runtime_config = {
            "tax_enabled": config.get("tax_enabled", False),
            "tax_rate": config.get("tax_rate", 0.125),
            "cloud_prices_enabled": config.get("cloud_prices_enabled", False),
            "investment_per_map": config.get("investment_per_map", 0),
        }

    def _apply_tax(self, item_id: str, price: float | None) -> float | None:
        """Apply configured tax rules to a raw price."""
        if price is None:
            return None

        if self._runtime_config.get("tax_enabled", False) and item_id != "100300":
            return price * (1 - self._runtime_config.get("tax_rate", 0.125))

        return price

    def _get_local_price(self, item_id: str) -> float | None:
        """Get the current local price with tax applied from the config snapshot."""
        return self._apply_tax(item_id, self.prices.get_price(item_id))

    def _get_cloud_price(self, item_id: str) -> float | None:
        """Get the current cloud price with tax applied from the config snapshot."""
        if not self.cloud_prices:
            return None
        return self._apply_tax(item_id, self.cloud_prices.get_price(item_id))

    def _has_persistable_session(self) -> bool:
        """Return whether the current session should be written to disk."""
        session = self.state.current_session
        if not session:
            return False
        return (
            self._session_persisted
            or bool(session.maps)
            or session.ended_at is not None
        )

    def _mark_session_dirty(self) -> None:
        """Mark the current session as needing a deferred disk flush."""
        if self._has_persistable_session():
            self._session_dirty = True

    def _persist_current_session(self) -> bool:
        """Write the current session to disk and clear the deferred dirty flag."""
        if not self.state.current_session:
            return False

        self.sessions.save_session(self.state.current_session)
        self._session_dirty = False
        self._session_persisted = True
        return True

    def _ensure_live_cache(self) -> None:
        """Rebuild cached aggregates if they are stale."""
        if self._live_dirty:
            self._rebuild_live_cache()

    def _rebuild_live_cache(self) -> None:
        """Rebuild aggregate live state from persisted raw session data."""
        self._reset_live_cache(mark_dirty=False)

        session = self.state.current_session
        if not session:
            return

        ignored = session.ignored_item_ids
        for index, map_run in enumerate(session.maps):
            self._live_completed_value += map_run.net_value_excluding(ignored)
            self._live_completed_items += map_run.total_items_excluding(ignored)
            self._live_completed_duration += map_run.duration_seconds
            if map_run.ended_at and not map_run.is_league_zone:
                self._live_completed_map_count += 1
                self._live_maps.append(
                    {
                        "index": index,
                        "total_value": map_run.net_value_excluding(ignored),
                        "duration_seconds": map_run.duration_seconds,
                        "ended_at_offset": (
                            map_run.ended_at - session.started_at
                        ).total_seconds(),
                    }
                )

            for drop in map_run.drops:
                self._accumulate_drop(drop, include_current_map=False, ignored=ignored)

        if self.state.current_map and (
            not session.maps or session.maps[-1] is not self.state.current_map
        ):
            for drop in self.state.current_map.drops:
                self._accumulate_drop(drop, include_current_map=True, ignored=ignored)

        self._refresh_item_metadata()

    def _accumulate_drop(
        self,
        drop: Drop,
        include_current_map: bool,
        ignored: set[str] | None = None,
    ) -> None:
        """Accumulate a raw drop into aggregate live state."""
        item_name = get_item_name(drop.item_id)
        if item_name.startswith("Unknown ("):
            return

        is_ignored = bool(ignored) and drop.item_id in ignored
        item_type = get_item_type(drop.item_id) or "Other"
        entry = self._live_items.setdefault(
            drop.item_id,
            {
                "item_id": drop.item_id,
                "item_name": item_name,
                "item_type": item_type,
                "quantity": 0,
                "value": 0.0,
                "price_status": "unknown",
                "price_source": "local",
                "ignored": is_ignored,
            },
        )
        entry["ignored"] = is_ignored

        entry["quantity"] += drop.quantity
        if drop.value is not None:
            entry["value"] += drop.value
            if not is_ignored and drop.value > 0:
                self._live_category_totals[item_type] = (
                    self._live_category_totals.get(item_type, 0.0) + drop.value
                )

        if include_current_map and not is_ignored:
            if drop.value is not None:
                self._live_current_value += drop.value
            if drop.quantity > 0:
                self._live_current_items += drop.quantity

    def _refresh_item_metadata(self) -> None:
        """Refresh price status/source metadata for aggregate rows."""
        for item_id, entry in self._live_items.items():
            _, price_status, price_source = self._resolve_price(item_id)
            entry["price_status"] = price_status
            entry["price_source"] = price_source

    def _apply_live_drop(
        self,
        item_id: str,
        item_name: str,
        item_type: str | None,
        quantity: int,
        value: float | None,
        price_status: str,
        price_source: str,
    ) -> None:
        """Incrementally apply a new live drop to aggregate state."""
        normalized_type = item_type or "Other"
        session = self.state.current_session
        is_ignored = bool(session) and item_id in session.ignored_item_ids
        entry = self._live_items.setdefault(
            item_id,
            {
                "item_id": item_id,
                "item_name": item_name,
                "item_type": normalized_type,
                "quantity": 0,
                "value": 0.0,
                "price_status": price_status,
                "price_source": price_source,
                "ignored": is_ignored,
            },
        )

        entry["item_name"] = item_name
        entry["item_type"] = normalized_type
        entry["ignored"] = is_ignored
        entry["quantity"] += quantity
        if value is not None:
            entry["value"] += value
            if not is_ignored:
                self._live_current_value += value
                if value > 0:
                    self._live_category_totals[normalized_type] = (
                        self._live_category_totals.get(normalized_type, 0.0) + value
                    )

        if not is_ignored and quantity > 0:
            self._live_current_items += quantity

        entry["price_status"] = price_status
        entry["price_source"] = price_source

    def process_log_chunk(self, text: str) -> None:
        """
        Process a chunk of new log content.

        This is the main entry point called by the LogWatcher.
        """
        if self._is_paused:
            self._process_log_chunk_paused(text)
            return

        self.refresh_runtime_config()
        skip_modfy = False
        init_items = self.parser.parse_bag_init(text)
        mods = self.parser.parse_bag_modifications(text)
        map_event = self.parser.parse_map_change(text)
        price_events = self.parser.parse_price_search(text)

        # Buffer InitBagData across watcher chunks so a split sort dump doesn't
        # overwrite earlier slots with a partial baseline.
        if init_items:
            self._buffer_init_items(init_items)
        should_finalize_init = self._pending_init_items and (
            not init_items or mods or map_event or price_events
        )
        if should_finalize_init:
            finalized_skip_modfy = self._flush_pending_init(process_changes=True)
            skip_modfy = skip_modfy or finalized_skip_modfy

        # Process bag modifications
        if self.state.is_initialized and not skip_modfy:
            if mods:
                changes = self.bag.process_modifications(mods)
                if changes:
                    self._process_drops(changes)

        # Check for map changes
        if map_event:
            if map_event.entering:
                self._on_map_enter(is_league_zone=map_event.is_league_zone)
            else:
                self._on_map_exit(is_league_zone=map_event.is_league_zone)

        # Extract price data from AH searches
        for event in price_events:
            final_price = self.prices.update_from_search(event.item_id, event.prices)
            self._backfill_prices(event.item_id)
            self._notify(
                "price_update", {"item_id": event.item_id, "price": final_price}
            )

    def _process_log_chunk_paused(self, text: str) -> None:
        """Process log while paused: silent bag, tracked transitions, live prices."""
        init_items = self.parser.parse_bag_init(text)
        mods = self.parser.parse_bag_modifications(text)
        map_event = self.parser.parse_map_change(text)
        price_events = self.parser.parse_price_search(text)

        # keep bag state current so resume doesn't produce a phantom diff
        if init_items:
            self._buffer_init_items(init_items)
        should_finalize_init = self._pending_init_items and (
            not init_items or mods or map_event or price_events
        )
        if should_finalize_init:
            self._flush_pending_init(process_changes=False)
        elif self.state.is_initialized:
            if mods:
                # advance slots and baseline, discard the diff
                self.bag.process_modifications(mods)

        # track map transitions so we can reconcile on resume
        if map_event:
            self._paused_live_in_map = map_event.entering
            self._paused_live_is_league_zone = map_event.is_league_zone
            self._paused_map_transitions += 1

        # price searches are orthogonal to session capture
        for event in price_events:
            final_price = self.prices.update_from_search(event.item_id, event.prices)
            self._backfill_prices(event.item_id)
            self._notify(
                "price_update", {"item_id": event.item_id, "price": final_price}
            )

    def _start_current_map(
        self, is_league_zone: bool = False, notify: bool = True
    ) -> None:
        """Start tracking a current map run without a fresh scene-change event."""
        self.state.is_in_map = True

        # Reset bag baseline for this map
        self.bag.reset_baseline()

        # Start new map run
        self.state.current_map = MapRun(
            started_at=datetime.now(), is_league_zone=is_league_zone
        )

        # Ensure we have a session
        if not self.state.current_session:
            self.state.current_session = self.sessions.create_session()
            self._session_dirty = False
            self._session_persisted = False
            self._reset_drop_index(mark_dirty=False)

        self._live_current_value = 0.0
        self._live_current_items = 0

        if notify:
            self._notify("map_enter", {})
            self._notify_state()

    def _on_map_enter(self, is_league_zone: bool = False) -> None:
        """Handle entering a map."""
        self._start_current_map(is_league_zone=is_league_zone, notify=True)

    def _on_map_exit(self, is_league_zone: bool = False) -> None:
        """Handle exiting a map."""
        if self.state.current_map:
            self.state.current_map.ended_at = datetime.now()

            # Capture investment setting at map completion (for non-league zones)
            if not is_league_zone:
                self.state.current_map.investment = self._runtime_config.get(
                    "investment_per_map", 0
                )

            # Add to session
            if self.state.current_session:
                self.state.current_session.maps.append(self.state.current_map)
                self._persist_current_session()

            if self._live_dirty:
                self._rebuild_live_cache()
            else:
                ignored = (
                    self.state.current_session.ignored_item_ids
                    if self.state.current_session
                    else set()
                )
                completed_net = self.state.current_map.net_value_excluding(ignored)
                self._live_completed_value += completed_net
                self._live_completed_items += self._live_current_items
                self._live_completed_duration += self.state.current_map.duration_seconds
                if (
                    not self.state.current_map.is_league_zone
                    and self.state.current_map.ended_at
                ):
                    self._live_completed_map_count += 1
                    self._live_maps.append(
                        {
                            "index": len(self.state.current_session.maps) - 1
                            if self.state.current_session
                            else 0,
                            "total_value": completed_net,
                            "duration_seconds": self.state.current_map.duration_seconds,
                            "ended_at_offset": (
                                self.state.current_map.ended_at
                                - self.state.current_session.started_at
                            ).total_seconds()
                            if self.state.current_session
                            else 0,
                        }
                    )

        self.state.is_in_map = False
        self.state.current_map = None
        self._live_current_value = 0.0
        self._live_current_items = 0

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

            price, price_status, price_source = self._resolve_price(item_id)
            value = price * quantity if price else None

            drop = Drop(
                item_id=item_id,
                quantity=quantity,
                timestamp=datetime.now(),
                value=value,
            )

            self.state.current_map.drops.append(drop)
            self._index_drop(drop)
            self._apply_live_drop(
                item_id=item_id,
                item_name=item_name,
                item_type=get_item_type(item_id),
                quantity=quantity,
                value=value,
                price_status=price_status,
                price_source=price_source,
            )

        self._notify_state()

    def _backfill_prices(self, item_id: str) -> None:
        """
        Update the value of all existing drops for this item in the current session.

        Called when a new price is discovered via AH search.

        Args:
            item_id: The item whose price was just updated
        """
        self.refresh_runtime_config()
        price = self._get_local_price(item_id)
        if price is None:
            # No price available, nothing to backfill
            return

        self._ensure_drop_index()
        changed = False
        for drop in self._drop_index.get(item_id, []):
            new_value = price * drop.quantity
            if drop.value != new_value:
                drop.value = new_value
                changed = True

        if changed:
            self._mark_session_dirty()
        self._mark_live_dirty()
        # Notify UI that state has changed
        self._notify_state()

    def _resolve_price(self, item_id: str) -> tuple[Any, str, str]:
        """
        Pick the best available price for an item.

        Returns (price_with_tax, price_status, price_source).
        Local wins unless cloud is newer.
        """
        local_price = self._get_local_price(item_id)
        local_age = self.prices.get_price_age(item_id)
        local_status = self.prices.get_price_status(item_id)

        cloud_price = None
        cloud_age = None
        cloud_status = "unknown"

        if self.cloud_prices and self._runtime_config.get(
            "cloud_prices_enabled", False
        ):
            cloud_price = self._get_cloud_price(item_id)
            if cloud_price is not None:
                cloud_age = self.cloud_prices.get_price_age(item_id)
                cloud_status = self.cloud_prices.get_price_status(item_id)

        # both exist: prefer whichever is more recent
        if local_price is not None and cloud_price is not None:
            if local_age is not None and cloud_age is not None:
                if local_age <= cloud_age:
                    return (local_price, local_status, "local")
                return (cloud_price, cloud_status, "cloud")
            if local_age is not None:
                return (local_price, local_status, "local")
            return (cloud_price, cloud_status, "cloud")

        if local_price is not None:
            return (local_price, local_status, "local")

        if cloud_price is not None:
            return (cloud_price, cloud_status, "cloud")

        return (None, "unknown", "local")

    def _backfill_cloud_prices(self) -> None:
        """Recalculate all drop values using best available price."""
        self.refresh_runtime_config()
        changed = False
        self._ensure_drop_index()

        for item_id, drops in self._drop_index.items():
            price, _, _ = self._resolve_price(item_id)
            if price is not None:
                for drop in drops:
                    candidate = price * drop.quantity
                    if drop.value != candidate:
                        drop.value = candidate
                        changed = True
            else:
                for drop in drops:
                    if drop.value is not None:
                        drop.value = None
                        changed = True

        if changed:
            self._mark_session_dirty()
            self._mark_live_dirty()

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

    def bootstrap_from_log_tail(self, text: str) -> bool:
        """
        Bootstrap current in-map state from recent existing log text.

        This lets the app start mid-map and still begin tracking after a bag sync,
        without replaying old bag modifications or stale drops from prior sessions.
        """
        if self.state.current_map or self.state.is_in_map:
            return False

        map_event = self.parser.parse_last_map_change(text)
        if not map_event or not map_event.entering:
            return False

        self._start_current_map(is_league_zone=map_event.is_league_zone, notify=False)
        return True

    def get_stats(self) -> dict:
        """Get current tracker statistics for UI."""
        self._flush_pending_init_if_idle(process_changes=not self._is_paused)
        self.refresh_runtime_config()
        self._ensure_live_cache()
        investment = self._runtime_config.get("investment_per_map", 0)

        current_map = None
        current_map_duration = 0
        current_map_net_value = 0
        if self.state.current_map:
            current_map_duration = self.state.current_map.duration_seconds
            # Current map: use config investment (not yet captured to map)
            current_map_net_value = self._live_current_value - investment
            current_map = {
                "duration": current_map_duration,
                "value": current_map_net_value,
                "items": self._live_current_items,
            }

        session = None
        if self.state.current_session:
            # session.net_value already includes completed-map investment;
            # add the live current-map net value on top.
            total_net_value = self._live_completed_value + current_map_net_value
            duration = self.state.current_session.session_duration
            hours = duration / 3600 if duration > 0 else 0
            value_per_hour = total_net_value / hours if hours > 0 else 0
            map_count = self._live_completed_map_count
            maps_per_hour = map_count / hours if hours > 0 else 0
            value_per_map = total_net_value / map_count if map_count > 0 else 0

            session = {
                "id": self.state.current_session.id,
                "paused": self._is_paused,
                "duration_mapping": (
                    self._live_completed_duration + current_map_duration
                ),
                "duration_total": duration,
                "value": total_net_value,
                "items": self._live_completed_items + self._live_current_items,
                "map_count": map_count,
                "value_per_hour": value_per_hour,
                "value_per_map": value_per_map,
                "maps_per_hour": maps_per_hour,
                "item_rows": list(self._live_items.values()),
                "category_totals": [
                    {"item_type": item_type, "value": value}
                    for item_type, value in sorted(
                        self._live_category_totals.items(),
                        key=lambda item: item[1],
                        reverse=True,
                    )
                ],
                "maps": list(self._live_maps),
            }

        return {
            "initialized": self.state.is_initialized,
            "awaiting_init": self._awaiting_init,
            "in_map": self.state.is_in_map,
            "display_mode": self.state.display_mode.value,
            "current_map": current_map,
            "session": session,
        }

    def request_initialization(self) -> dict:
        """
        Request bag initialization.

        The user should sort their bag in-game after calling this.
        """
        self._clear_pending_init_buffer()
        self._awaiting_init = True
        self.bag.clear()
        self.state.is_initialized = False

        return {"status": "waiting", "message": "Sort your bag in-game to initialize"}

    def toggle_ignore_item(self, item_id: str) -> dict:
        """Toggle whether an item id is excluded from session aggregates."""
        session = self.state.current_session
        if not session:
            return {"status": "error", "message": "no active session"}

        if item_id in session.ignored_item_ids:
            session.ignored_item_ids.discard(item_id)
            now_ignored = False
        else:
            session.ignored_item_ids.add(item_id)
            now_ignored = True

        self._mark_live_dirty()
        self._mark_session_dirty()
        self.flush_current_session()
        self._notify_state()
        return {"status": "ok", "item_id": item_id, "ignored": now_ignored}

    def set_display_mode(self, mode: str) -> None:
        """Set the display mode (value or items)."""
        try:
            self.state.display_mode = DisplayMode(mode)
            self._notify_state()
        except ValueError:
            pass

    def toggle_pause(self) -> dict:
        """Toggle pause state. Returns current paused status."""
        if self._is_paused:
            return self._resume_tracking()
        return self._pause_tracking()

    def _pause_tracking(self) -> dict:
        now = datetime.now()
        self._is_paused = True
        self._pause_started_at = now
        self._paused_live_in_map = self.state.is_in_map
        self._paused_live_is_league_zone = False
        self._paused_map_transitions = 0

        if self.state.current_session:
            self.state.current_session.pause(now)
        if self.state.current_map:
            self.state.current_map.pause(now)

        self._mark_live_dirty()
        self._notify_state()
        return {"status": "ok", "paused": True}

    def _resume_tracking(self) -> dict:
        now = datetime.now()
        self._is_paused = False
        self.refresh_runtime_config()

        if self.state.current_session:
            self.state.current_session.resume(now)

        # reconcile map state: what was happening when we paused vs now
        was_in_map = self.state.current_map is not None
        now_in_map = self._paused_live_in_map
        had_transitions = self._paused_map_transitions > 0

        if was_in_map and (not now_in_map or had_transitions):
            # left the map (or left and re-entered a different one); close at pause
            self.state.current_map.paused_at = (
                None  # clear so duration_seconds doesn't subtract phantom pause
            )
            self.state.current_map.ended_at = self._pause_started_at
            if not self.state.current_map.is_league_zone:
                self.state.current_map.investment = self._runtime_config.get(
                    "investment_per_map", 0
                )
            if self.state.current_session:
                self.state.current_session.maps.append(self.state.current_map)
                self._persist_current_session()
            self.state.current_map = None
            self.state.is_in_map = False

        if now_in_map and (not was_in_map or had_transitions):
            # entered a (new) map while paused — start a fresh one
            self.state.is_in_map = True
            self.state.current_map = MapRun(
                started_at=now,
                is_league_zone=self._paused_live_is_league_zone,
            )
            if not self.state.current_session:
                self.state.current_session = self.sessions.create_session()
                self._session_dirty = False
                self._session_persisted = False
                self._reset_drop_index(mark_dirty=False)
        elif was_in_map and now_in_map and not had_transitions:
            # never left the map — resume its timer
            self.state.current_map.resume(now)

        # always reset baseline so paused loot is invisible
        self.bag.reset_baseline()

        self._pause_started_at = None
        self._mark_live_dirty()
        self._notify_state()
        return {"status": "ok", "paused": False}

    def flush_current_session(self) -> bool:
        """Flush any deferred current-session persistence to disk."""
        if not self._session_dirty:
            return False
        if not self._has_persistable_session():
            return False
        return self._persist_current_session()

    def reset_session(self) -> None:
        """Reset the current session."""
        # clear pause state
        self._is_paused = False
        self._pause_started_at = None

        # End current session if exists
        if self.state.current_session:
            self.state.current_session.ended_at = datetime.now()
            self._persist_current_session()

        # Start fresh
        self.state.current_session = None
        self.state.current_map = None
        self.state.is_in_map = False
        self._session_dirty = False
        self._session_persisted = False
        self._reset_live_cache()
        self._reset_drop_index()

        self._notify("session_reset", {})
        self._notify_state()

    def reset_all(self) -> None:
        """Reset all tracking state."""
        self._is_paused = False
        self._pause_started_at = None

        self.bag.clear()
        self.state = TrackerState()
        self._awaiting_init = False
        self._clear_pending_init_buffer()
        self._session_dirty = False
        self._session_persisted = False
        self._reset_live_cache()
        self._reset_drop_index()

        self._notify("reset", {})
        self._notify_state()
