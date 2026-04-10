from app.price_manager import PriceManager
from app.storage import save_config


def test_update_from_search_filters_outliers_and_saves_price() -> None:
    manager = PriceManager()

    price = manager.update_from_search("2001", [10.0, 10.0, 10.0, 10.0, 9999.0])

    assert price == 10.0
    assert manager.get_price("2001") == 10.0


def test_get_price_with_tax_respects_config() -> None:
    manager = PriceManager()
    manager.set_price("2001", 100.0)
    save_config({"tax_enabled": True, "tax_rate": 0.125})

    assert manager.get_price_with_tax("2001") == 87.5
    assert manager.get_price_with_tax("100300") == 1.0
