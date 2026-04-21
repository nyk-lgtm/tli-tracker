"""Resolve user-facing map names from captured beacon + level_id.

Used by both live tracking (tracker.py) and session viewer rendering
(session_manager.py) so new and historical MapRuns format identically.
"""

from __future__ import annotations

import re
from typing import Optional

from .storage import get_item_name

# LevelId ranges observed from in-game log samples. Each tier's ids span
# 100 consecutive values. Ranges outside this table fall through to the
# numbered-placeholder fallback.
_TIER_RANGES: list[tuple[int, int, str]] = [
    (4600, 4700, "T7-0"),
    (4700, 4800, "T7-1"),
    (4800, 4900, "T7-2"),
    (5000, 5100, "T8-0"),
    (5100, 5200, "T8-1"),
    (5200, 5300, "T8-2"),
    (5300, 5400, "T8 Profound"),
]

_TIMEMARK_PAREN = re.compile(r"\s*\(Timemark \d+\)")


def classify_tier(level_id: Optional[int]) -> Optional[str]:
    """Return the tier label for a level_id, or None if outside known ranges."""
    if level_id is None:
        return None
    for start, end, label in _TIER_RANGES:
        if start <= level_id < end:
            return label
    return None


def resolve_map_name(map_item_ids: list[str], level_id: Optional[int]) -> str:
    """Build the display name from a captured beacon id and level id.

    Returns an empty string if the beacon can't be resolved; callers fall
    back to a numbered placeholder in that case.
    """
    if not map_item_ids:
        return ""
    beacon_id = map_item_ids[0]
    base = get_item_name(beacon_id)
    if base.startswith("Unknown ("):
        return ""

    # strip trailing " Beacon" so the card reads "Glacial Abyss (Timemark 8)"
    # rather than "Glacial Abyss Beacon (Timemark 8)"
    base = base.replace(" Beacon", "")

    tier = classify_tier(level_id)
    if tier and tier.startswith("T"):
        # replace "(Timemark N)" with the specific tier so T8-0 / T8-1 /
        # T8-2 / T8 Profound show correctly instead of lumping as (Timemark 8)
        base = _TIMEMARK_PAREN.sub("", base).rstrip()
        return f"{base} ({tier})"

    return base
