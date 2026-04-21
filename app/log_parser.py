"""
Log parser for Torchlight Infinite game logs.
"""

import re
from dataclasses import dataclass
from typing import Dict, Optional


@dataclass
class BagModifyEvent:
    page_id: int
    slot_id: int
    item_id: str
    quantity: int


@dataclass
class BagRemoveEvent:
    """Emitted when a slot goes to zero and the game tears it down.

    Unlike BagModifyEvent, the item id is not present in the log line;
    callers reconstruct it from their current bag state (the slot's last
    known occupant).
    """

    page_id: int
    slot_id: int


@dataclass
class MapChangeEvent:
    entering: bool
    is_league_zone: bool = False


@dataclass
class LevelLinkEvent:
    """Identifies the specific map instance being loaded.

    level_type == 3 is a gameplay map; 0 is the hideout/refuge. level_id
    falls in a tier-specific range (see tracker.resolve_map_name for the
    table).
    """

    level_uid: int
    level_type: int
    level_id: int


@dataclass
class PriceDataEvent:
    item_id: str
    prices: list[float]
    average_price: float


class LogParser:
    """
    Parses Torchlight Infinite game log entries.
    Maintains state to link asynchronous Search Requests with Search Results.
    """

    # --- REGEX PATTERNS ---

    PATTERN_BAG_MODIFY = re.compile(
        r"BagMgr@:Modfy BagItem PageId = (\d+) SlotId = (\d+) "
        r"ConfigBaseId = (\d+) Num = (\d+)"
    )

    PATTERN_BAG_INIT = re.compile(
        r"BagMgr@:InitBagData PageId = (\d+) SlotId = (\d+) "
        r"ConfigBaseId = (\d+) Num = (\d+)"
    )

    # emitted when a slot's stack hits zero — the game tears the slot down
    # instead of emitting a Modfy with Num=0. the ConfigBaseId isn't in the
    # line, callers have to look it up from prior bag state.
    PATTERN_BAG_REMOVE = re.compile(
        r"BagMgr@:RemoveBagItem PageId = (\d+) SlotId = (\d+)"
    )

    PATTERN_SCENE_CHANGE = re.compile(
        r"PageApplyBase@ _UpdateGameEnd:.*?"
        r"LastSceneName = World'/Game/Art/(?:Maps|Season/S\d+/Maps)/([^']+)'.*?"
        r"NextSceneName = World'/Game/Art/(?:Maps|Season/S\d+/Maps)/([^']+)'",
        re.DOTALL,
    )

    PATTERN_LEAGUE_ZONE = re.compile(
        r"PageApplyBase@ _UpdateGameEnd:.*?"
        r"NextSceneName = World'/Game/Art/(?:Maps/S2|Season/S9/Maps|Season/S13/Maps)/",
        re.DOTALL,
    )

    PATTERN_LEVEL_LINK = re.compile(
        r"LevelMgr@ LevelUid, LevelType, LevelId = (\d+) (\d+) (\d+)"
    )

    # 1. Capture the Request Block: From "SendMessage STT" to "SendMessage End"
    # Matches: ... SynId = 123 ... [CONTENT] ... SendMessage End
    PATTERN_SEARCH_REQ_BLOCK = re.compile(
        r"SendMessage STT----XchgSearchPrice----SynId\s*=\s*(\d+)(.*?)SendMessage End",
        re.DOTALL,
    )

    # Extract ID from inside the Request Block
    PATTERN_REFER_ID = re.compile(r"refer\s*\[([^\]]+)\]")

    # 2. Capture the Response Block: From "RecvMessage STT" to "RecvMessage End"
    # Matches: ... SynId = 123 ... [CONTENT] ... RecvMessage End
    PATTERN_SEARCH_RESP_BLOCK = re.compile(
        r"RecvMessage STT----XchgSearchPrice----SynId\s*=\s*(\d+)(.*?)RecvMessage End",
        re.DOTALL,
    )

    # 3. Parse Prices: Matches +1 [100.0] inside the response block
    # Handles complex formats and ignores timestamps
    PATTERN_PRICE_VALUE = re.compile(r"\+\d+\s+\[([\d.]+)\]")

    REFUGE_SCENE = "01SD/XZ_YuJinZhiXiBiNanSuo200"

    def __init__(self):
        # Stores { SynId: ItemId } to link requests to responses
        self.pending_searches: Dict[str, str] = {}

    def parse_bag_modifications(self, text: str) -> list[BagModifyEvent]:
        events = []
        for match in self.PATTERN_BAG_MODIFY.finditer(text):
            events.append(
                BagModifyEvent(
                    page_id=int(match.group(1)),
                    slot_id=int(match.group(2)),
                    item_id=match.group(3),
                    quantity=int(match.group(4)),
                )
            )
        return events

    def parse_bag_removals(self, text: str) -> list[BagRemoveEvent]:
        """Find slot-teardown events (stack went to zero)."""
        events = []
        for match in self.PATTERN_BAG_REMOVE.finditer(text):
            events.append(
                BagRemoveEvent(
                    page_id=int(match.group(1)),
                    slot_id=int(match.group(2)),
                )
            )
        return events

    def parse_bag_init(self, text: str) -> list[BagModifyEvent]:
        events = []
        for match in self.PATTERN_BAG_INIT.finditer(text):
            events.append(
                BagModifyEvent(
                    page_id=int(match.group(1)),
                    slot_id=int(match.group(2)),
                    item_id=match.group(3),
                    quantity=int(match.group(4)),
                )
            )
        return events

    def parse_map_change(self, text: str) -> Optional[MapChangeEvent]:
        # Check if this is a league mechanic zone (S2, S9, S13)
        is_league_zone = bool(self.PATTERN_LEAGUE_ZONE.search(text))

        match = self.PATTERN_SCENE_CHANGE.search(text)
        if not match:
            return None

        last_scene, next_scene = match.group(1), match.group(2)

        if self.REFUGE_SCENE in last_scene and self.REFUGE_SCENE not in next_scene:
            return MapChangeEvent(entering=True, is_league_zone=is_league_zone)

        if self.REFUGE_SCENE not in last_scene and self.REFUGE_SCENE in next_scene:
            return MapChangeEvent(entering=False, is_league_zone=is_league_zone)

        return None

    def parse_last_level_link(
        self, text: str, level_type: Optional[int] = None
    ) -> Optional[LevelLinkEvent]:
        """Return the last LevelMgr level-link record in the chunk, if any.

        The game emits this line milliseconds before the _UpdateGameEnd
        scene change. When a chunk spans both a map entry and the
        subsequent return-to-hideout, the last match is the hideout's
        (level_type=0, level_id=110). Callers pairing with a map_enter
        should pass ``level_type=3`` to skip the hideout entry and find
        the incoming map's identity.
        """
        last = None
        for match in self.PATTERN_LEVEL_LINK.finditer(text):
            lt = int(match.group(2))
            if level_type is not None and lt != level_type:
                continue
            last = (int(match.group(1)), lt, int(match.group(3)))
        if last is None:
            return None
        return LevelLinkEvent(level_uid=last[0], level_type=last[1], level_id=last[2])

    def parse_last_map_change(self, text: str) -> Optional[MapChangeEvent]:
        """Return the most recent map transition found in a block of log text."""
        last_match = None
        for match in self.PATTERN_SCENE_CHANGE.finditer(text):
            last_match = match

        if not last_match:
            return None

        event_text = last_match.group(0)
        is_league_zone = bool(self.PATTERN_LEAGUE_ZONE.search(event_text))
        last_scene, next_scene = last_match.group(1), last_match.group(2)

        if self.REFUGE_SCENE in last_scene and self.REFUGE_SCENE not in next_scene:
            return MapChangeEvent(entering=True, is_league_zone=is_league_zone)

        if self.REFUGE_SCENE not in last_scene and self.REFUGE_SCENE in next_scene:
            return MapChangeEvent(entering=False, is_league_zone=is_league_zone)

        return None

    def parse_price_search(self, text: str) -> list[PriceDataEvent]:
        """
        Extract price data by linking SendMessage (Item ID) with RecvMessage (Prices).
        """
        events = []

        # 1. Find all Search Requests (The "Ask")
        # We need the entire block ending with "SendMessage End"
        # so request parsing still has access to the item ID.
        for match in self.PATTERN_SEARCH_REQ_BLOCK.finditer(text):
            syn_id = match.group(1)
            content = match.group(2)

            # Find the Item ID inside this block
            id_match = self.PATTERN_REFER_ID.search(content)
            if id_match:
                item_id = id_match.group(1)
                self.pending_searches[syn_id] = item_id

        # 2. Find all Search Responses (The "Result")
        # We look for the entire block ending with 'RecvMessage End'
        for match in self.PATTERN_SEARCH_RESP_BLOCK.finditer(text):
            syn_id = match.group(1)
            content = match.group(2)

            # Do we know which item this SynId belongs to?
            if syn_id in self.pending_searches:
                item_id = self.pending_searches.pop(syn_id)  # Retrieve and remove

                # Parse all prices in this block
                prices = [
                    float(m.group(1))
                    for m in self.PATTERN_PRICE_VALUE.finditer(content)
                ]

                if prices:
                    # Average the first 100 prices
                    num_prices = min(len(prices), 100)
                    avg_price = sum(prices[:num_prices]) / num_prices

                    events.append(
                        PriceDataEvent(
                            item_id=item_id,
                            prices=prices[5:num_prices],
                            average_price=round(avg_price, 4),
                        )
                    )

        return events
