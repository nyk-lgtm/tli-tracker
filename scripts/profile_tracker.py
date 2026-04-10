"""
Profile the current tracker heartbeat hotspot with synthetic session data.
"""
# ruff: noqa: E402

from __future__ import annotations

import json
import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app import session_manager, storage
from app.models import Drop, MapRun, Session
from app.price_manager import PriceManager
from app.session_manager import SessionManager
from app.tracker import Tracker


@dataclass(frozen=True)
class Scenario:
    name: str
    completed_maps: int
    drops_per_map: int
    current_map_drops: int


SCENARIOS = [
    Scenario("small", completed_maps=10, drops_per_map=12, current_map_drops=8),
    Scenario("medium", completed_maps=50, drops_per_map=20, current_map_drops=12),
    Scenario("large", completed_maps=150, drops_per_map=30, current_map_drops=20),
]


def configure_isolated_storage(root: Path) -> None:
    data_dir = root / "data"
    data_dir.mkdir()
    (data_dir / "sessions").mkdir()

    storage.DATA_DIR = data_dir
    session_manager.DATA_DIR = data_dir
    storage._item_cache = {
        "100300": {"name": "Flame Elementium", "type": "Currency"},
        "2001": {"name": "Divine Core", "type": "Currency"},
        "3001": {"name": "Ember Relic", "type": "Relic"},
    }


def build_tracker(scenario: Scenario) -> Tracker:
    price_manager = PriceManager()
    session_mgr = SessionManager()
    tracker = Tracker(price_manager, session_mgr, on_update=lambda *_: None)
    tracker.prices.set_price("2001", 12.5)
    tracker.prices.set_price("3001", 4.0)

    started_at = datetime.now() - timedelta(hours=2)
    completed_maps: list[MapRun] = []

    for map_index in range(scenario.completed_maps):
        map_started = started_at + timedelta(minutes=map_index * 5)
        drops = []
        for drop_index in range(scenario.drops_per_map):
            item_id = "2001" if drop_index % 2 == 0 else "3001"
            quantity = (drop_index % 3) + 1
            price = tracker.prices.get_price_with_tax(item_id)
            drops.append(
                Drop(
                    item_id=item_id,
                    quantity=quantity,
                    timestamp=map_started + timedelta(seconds=drop_index),
                    value=price * quantity if price is not None else None,
                )
            )

        completed_maps.append(
            MapRun(
                started_at=map_started,
                ended_at=map_started + timedelta(minutes=4),
                drops=drops,
                investment=1.0,
            )
        )

    tracker.state.current_session = Session(
        id=f"profile-{scenario.name}",
        started_at=started_at,
        maps=completed_maps,
    )

    now = datetime.now() - timedelta(minutes=4)
    current_drops = []
    for drop_index in range(scenario.current_map_drops):
        item_id = "2001" if drop_index % 2 == 0 else "3001"
        quantity = 1 + (drop_index % 2)
        price = tracker.prices.get_price_with_tax(item_id)
        current_drops.append(
            Drop(
                item_id=item_id,
                quantity=quantity,
                timestamp=now + timedelta(seconds=drop_index),
                value=price * quantity if price is not None else None,
            )
        )

    tracker.state.current_map = MapRun(started_at=now, drops=current_drops)
    tracker.state.is_initialized = True
    tracker.state.is_in_map = True
    return tracker


def run_measurement(label: str, callback, loops: int = 25) -> tuple[float, object]:
    start = time.perf_counter()
    result = None
    for _ in range(loops):
        result = callback()
    elapsed = time.perf_counter() - start
    per_loop_ms = (elapsed / loops) * 1000
    print(f"{label:<20} {per_loop_ms:>8.3f} ms")
    return per_loop_ms, result


def main() -> None:
    print("Tracker heartbeat profiling")
    print("===========================")

    with tempfile.TemporaryDirectory(prefix="tli_tracker_profile_") as temp_root:
        configure_isolated_storage(Path(temp_root))

        for scenario in SCENARIOS:
            tracker = build_tracker(scenario)
            print(
                f"\nScenario: {scenario.name} "
                f"({scenario.completed_maps} completed maps, "
                f"{scenario.drops_per_map} drops/map, "
                f"{scenario.current_map_drops} current-map drops)"
            )

            _, stats = run_measurement("tracker.get_stats()", tracker.get_stats)
            payload = stats if stats is not None else tracker.get_stats()
            run_measurement(
                "json.dumps(stats)",
                lambda: json.dumps(payload, default=str),
            )
            run_measurement(
                "get_stats + dumps",
                lambda: json.dumps(tracker.get_stats(), default=str),
            )


if __name__ == "__main__":
    main()
