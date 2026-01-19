"""
Log parser for Torchlight Infinite game logs.
"""

import re
from dataclasses import dataclass
from typing import Optional, Dict


@dataclass
class BagModifyEvent:
    page_id: int
    slot_id: int
    item_id: str
    quantity: int


@dataclass
class MapChangeEvent:
    entering: bool
    is_league_zone: bool = False


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

    def parse_price_search(self, text: str) -> list[PriceDataEvent]:
        """
        Extract price data by linking SendMessage (Item ID) with RecvMessage (Prices).
        """
        events = []

        # 1. Find all Search Requests (The "Ask")
        # We look for the entire block ending with 'SendMessage End' to ensure we capture the ID
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
