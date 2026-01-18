"""
Price database manager.

Handles storing and retrieving item prices parsed from
auction house searches in the game log.
"""

from datetime import datetime
from typing import Optional
from .storage import load_json, save_json, load_config


class PriceManager:
    """
    Manages the local price database.

    Prices are stored as:
    {
        "item_id": {
            "price": 123.45,
            "updated_at": "2024-01-15T10:30:00"
        }
    }
    """

    FILENAME = "prices.json"
    FIXED_PRICES = {"100300": 1.0} # FE price should always be 1.0

    def __init__(self):
        self._prices: dict[str, dict] = {}
        self._load()

    def _load(self) -> None:
        """Load prices from disk."""
        self._prices = load_json(self.FILENAME, {})
        # Ensure fixed prices are set
        current_time = datetime.datetime.now().isoformat()
        for item_id, price_value in self.FIXED_PRICES.items():
            self._prices[item_id] = {
                "price": price_value,
                "updated_at": current_time
            }

    def _save(self) -> None:
        """Save prices to disk."""
        save_json(self.FILENAME, self._prices)

    def get_price(self, item_id: str) -> Optional[float]:
        """
        Get the price for an item.

        Args:
            item_id: The item's ConfigBaseId

        Returns:
            Price value or None if not found
        """
        entry = self._prices.get(item_id)
        if entry:
            return entry.get("price")
        return None

    def get_price_with_tax(self, item_id: str) -> Optional[float]:
        """
        Get the price for an item, applying tax if enabled.

        Tax is the auction house fee (12.5% by default).
        """
        price = self.get_price(item_id)
        if price is None:
            return None

        config = load_config()
        if config.get("tax_enabled", False):
            tax_rate = config.get("tax_rate", 0.125)
            # Currency (100300) is exempt from tax
            if item_id != "100300":
                price = price * (1 - tax_rate)

        return price

    def set_price(self, item_id: str, price: float) -> None:
        """
        Set the price for an item.

        Args:
            item_id: The item's ConfigBaseId
            price: The price value
        """
        if item_id in self.FIXED_PRICES:
            return

        self._prices[item_id] = {
            "price": round(price, 4),
            "updated_at": datetime.now().isoformat()
        }
        self._save()

    def update_from_search(self, item_id: str, prices: list[float]) -> float:
        """
        Update price from an auction house search result.

        Calculates the average of the provided prices and stores it.

        Args:
            item_id: The item's ConfigBaseId
            prices: List of prices from the search results

        Returns:
            The calculated average price
        """
        if item_id in self.FIXED_PRICES:
            return self.FIXED_PRICES[item_id]

        if not prices:
            return 0.0

        avg_price = sum(prices) / len(prices)
        self.set_price(item_id, avg_price)
        return avg_price

    def get_all(self) -> dict[str, dict]:
        """Get all prices."""
        return self._prices.copy()

    def get_price_age(self, item_id: str) -> Optional[float]:
        """
        Get how old a price is in seconds.

        Returns:
            Age in seconds, or None if no price exists
        """
        entry = self._prices.get(item_id)
        if not entry or "updated_at" not in entry:
            return None

        try:
            updated_at = datetime.fromisoformat(entry["updated_at"])
            age = (datetime.now() - updated_at).total_seconds()
            return age
        except (ValueError, TypeError):
            return None

    def get_price_status(self, item_id: str) -> str:
        """
        Get the freshness status of a price.

        Returns:
            "fresh" (< 3 min), "stale" (< 15 min), "old" (>= 15 min), or "unknown"
        """
        age = self.get_price_age(item_id)
        if age is None:
            return "unknown"

        if age < 180:  # 3 minutes
            return "fresh"
        elif age < 900:  # 15 minutes
            return "stale"
        else:
            return "old"

    def clear(self) -> None:
        """Clear all prices."""
        self._prices.clear()
        self._save()

    def remove_price(self, item_id: str) -> bool:
        """Remove a price entry."""
        if item_id in self._prices:
            del self._prices[item_id]
            self._save()
            return True
        return False
