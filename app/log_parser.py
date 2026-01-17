"""
Log parser for Torchlight Infinite game logs.

Parses the UE_game.log file to extract:
- Bag modifications (item pickups/consumption)
- Bag initialization (full inventory snapshot)
- Map enter/exit events
- Auction house price searches
"""

import re
from dataclasses import dataclass
from typing import Optional


@dataclass
class BagModifyEvent:
    """Represents a bag item modification."""
    page_id: int
    slot_id: int
    item_id: str
    quantity: int


@dataclass
class MapChangeEvent:
    """Represents entering or exiting a map."""
    entering: bool  # True = entering map, False = returning to refuge


@dataclass
class PriceDataEvent:
    """Represents price data from an AH search."""
    item_id: str
    prices: list[float]
    average_price: float


class LogParser:
    """
    Parses Torchlight Infinite game log entries.

    All patterns are compiled once for efficiency.
    """

    # Pattern for bag item modifications
    # Example: BagMgr@:Modfy BagItem PageId = 1 SlotId = 5 ConfigBaseId = 100301 Num = 50
    PATTERN_BAG_MODIFY = re.compile(
        r'BagMgr@:Modfy BagItem PageId = (\d+) SlotId = (\d+) '
        r'ConfigBaseId = (\d+) Num = (\d+)'
    )

    # Pattern for full bag initialization (when user sorts bag)
    # Example: BagMgr@:InitBagData PageId = 1 SlotId = 0 ConfigBaseId = 100300 Num = 1000
    PATTERN_BAG_INIT = re.compile(
        r'BagMgr@:InitBagData PageId = (\d+) SlotId = (\d+) '
        r'ConfigBaseId = (\d+) Num = (\d+)'
    )

    # Pattern for scene/map changes
    # Detects when player enters or exits maps
    PATTERN_SCENE_CHANGE = re.compile(
        r"PageApplyBase@ _UpdateGameEnd:.*?"
        r"LastSceneName = World'/Game/Art/Maps/([^']+)'.*?"
        r"NextSceneName = World'/Game/Art/Maps/([^']+)'",
        re.DOTALL
    )

    # Pattern for AH price search header
    PATTERN_PRICE_HEADER = re.compile(
        r'XchgSearchPrice----SynId = (\d+).*?\+refer \[(\d+)\]'
    )

    # Pattern for individual price values in AH search results
    PATTERN_PRICE_VALUE = re.compile(r'\+\d+\s+\[([\d.]+)\]')

    # The refuge/hideout scene identifier
    REFUGE_SCENE = "01SD/XZ_YuJinZhiXiBiNanSuo200"

    def parse_bag_modifications(self, text: str) -> list[BagModifyEvent]:
        """
        Parse BagMgr@:Modfy entries from log text.

        These entries appear when items are added/removed/moved in inventory.
        """
        events = []
        for match in self.PATTERN_BAG_MODIFY.finditer(text):
            events.append(BagModifyEvent(
                page_id=int(match.group(1)),
                slot_id=int(match.group(2)),
                item_id=match.group(3),
                quantity=int(match.group(4))
            ))
        return events

    def parse_bag_init(self, text: str) -> list[BagModifyEvent]:
        """
        Parse BagMgr@:InitBagData entries from log text.

        These entries appear when the user sorts their bag, providing
        a complete snapshot of the inventory state.
        """
        events = []
        for match in self.PATTERN_BAG_INIT.finditer(text):
            events.append(BagModifyEvent(
                page_id=int(match.group(1)),
                slot_id=int(match.group(2)),
                item_id=match.group(3),
                quantity=int(match.group(4))
            ))
        return events

    def parse_map_change(self, text: str) -> Optional[MapChangeEvent]:
        """
        Detect map enter/exit from scene change log entries.

        Returns:
            MapChangeEvent if a map transition occurred, None otherwise.
        """
        match = self.PATTERN_SCENE_CHANGE.search(text)
        if not match:
            return None

        last_scene, next_scene = match.group(1), match.group(2)

        # Leaving refuge = entering a map
        if self.REFUGE_SCENE in last_scene and self.REFUGE_SCENE not in next_scene:
            return MapChangeEvent(entering=True)

        # Entering refuge = exiting a map
        if self.REFUGE_SCENE not in last_scene and self.REFUGE_SCENE in next_scene:
            return MapChangeEvent(entering=False)

        return None

    def parse_all_map_changes(self, text: str) -> list[MapChangeEvent]:
        """
        Parse all map changes in a text block.

        Useful when processing a large chunk of log that may contain
        multiple map transitions.
        """
        events = []
        for match in self.PATTERN_SCENE_CHANGE.finditer(text):
            last_scene, next_scene = match.group(1), match.group(2)

            if self.REFUGE_SCENE in last_scene and self.REFUGE_SCENE not in next_scene:
                events.append(MapChangeEvent(entering=True))
            elif self.REFUGE_SCENE not in last_scene and self.REFUGE_SCENE in next_scene:
                events.append(MapChangeEvent(entering=False))

        return events

    def parse_price_search(self, text: str) -> list[PriceDataEvent]:
        """
        Extract price data from auction house search results.

        When a player searches the AH, the game logs the search results
        including prices. We extract and average the first 30 prices.
        """
        events = []

        # Find all price search headers
        for header_match in self.PATTERN_PRICE_HEADER.finditer(text):
            syn_id = header_match.group(1)
            item_id = header_match.group(2)

            # Skip currency (item_id 100300)
            if item_id == "100300":
                continue

            # Find the data block for this search
            # Look for content between this SynId and the next one
            start_pos = header_match.end()

            # Find the end of this data block (next SynId or end of text)
            next_header = self.PATTERN_PRICE_HEADER.search(text, start_pos)
            end_pos = next_header.start() if next_header else len(text)

            data_block = text[start_pos:end_pos]

            # Extract price values
            prices = [float(m.group(1)) for m in self.PATTERN_PRICE_VALUE.finditer(data_block)]

            if prices:
                # Average the first 30 prices (or all if fewer)
                num_prices = min(len(prices), 30)
                avg_price = sum(prices[:num_prices]) / num_prices

                events.append(PriceDataEvent(
                    item_id=item_id,
                    prices=prices[:num_prices],
                    average_price=round(avg_price, 4)
                ))

        return events
