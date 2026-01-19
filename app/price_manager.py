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
    FIXED_PRICES = {"100300": 1.0}  # FE price should always be 1.0

    def __init__(self):
        self._prices: dict[str, dict] = {}
        self._load()

    def _load(self) -> None:
        """Load prices from disk."""
        self._prices = load_json(self.FILENAME, {})
        # Ensure fixed prices are set
        current_time = datetime.now().isoformat()
        for item_id, price_value in self.FIXED_PRICES.items():
            self._prices[item_id] = {"price": price_value, "updated_at": current_time}

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
            "updated_at": datetime.now().isoformat(),
        }
        self._save()

    def update_from_search(self, item_id: str, prices: list[float]) -> float:
        """
        Update price from an auction house search result.

        Uses MAD (Median Absolute Deviation) method to remove outlier values
        (like price fixing at 9999 or accidental 1 gold listings).
        This method is more robust than IQR when outliers comprise >25% of data.

        Args:
            item_id: The item's ConfigBaseId
            prices: List of prices from the search results

        Returns:
            The calculated average price after removing outliers
        """
        if item_id in self.FIXED_PRICES:
            return self.FIXED_PRICES[item_id]

        if not prices:
            return 0.0

        # For small datasets, use median (safest for low volume)
        if len(prices) < 5:
            sorted_prices = sorted(prices)
            n = len(sorted_prices)
            median_idx = n // 2
            if n % 2 == 0:
                avg_price = (
                    sorted_prices[median_idx - 1] + sorted_prices[median_idx]
                ) / 2
            else:
                avg_price = sorted_prices[median_idx]
            self.set_price(item_id, avg_price)
            return avg_price

        # MAD-based outlier detection for larger datasets
        sorted_prices = sorted(prices)
        n = len(sorted_prices)

        # Calculate median
        median_idx = n // 2
        if n % 2 == 0:
            median = (sorted_prices[median_idx - 1] + sorted_prices[median_idx]) / 2
        else:
            median = sorted_prices[median_idx]

        # Calculate absolute deviations from median
        deviations = [abs(p - median) for p in sorted_prices]
        sorted_deviations = sorted(deviations)

        # Calculate MAD (median of absolute deviations)
        mad_idx = len(sorted_deviations) // 2
        if len(sorted_deviations) % 2 == 0:
            mad = (sorted_deviations[mad_idx - 1] + sorted_deviations[mad_idx]) / 2
        else:
            mad = sorted_deviations[mad_idx]

        # Handle case where MAD is 0 (>50% of values are identical)
        if mad == 0:
            # Use 5% of median as minimum threshold
            threshold = median * 0.05 if median > 0 else 0.01
            filtered_prices = [p for p in sorted_prices if abs(p - median) <= threshold]
        else:
            # Calculate modified Z-scores and filter outliers
            # Modified Z-score = 0.6745 * (x - median) / MAD
            # Filter out items where |Z-score| > 3.5
            filtered_prices = []
            for p in sorted_prices:
                modified_z = 0.6745 * abs(p - median) / mad
                if modified_z <= 3.5:
                    filtered_prices.append(p)

        # Calculate average of filtered prices
        if filtered_prices:
            avg_price = sum(filtered_prices) / len(filtered_prices)
        else:
            # Fallback to median if all prices were filtered (shouldn't happen)
            avg_price = median

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
