from app import storage
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


def test_invalid_price_cache_is_preserved_on_next_save() -> None:
    cache_path = storage.DATA_DIR / "prices.json"
    cache_path.write_text("{bad json", encoding="utf-8")

    manager = PriceManager()

    assert manager.get_price("2001") is None
    manager.set_price("2001", 12.5)

    backups = list(storage.DATA_DIR.glob("prices.json.corrupt.*"))
    assert len(backups) == 1
    assert backups[0].read_text(encoding="utf-8") == "{bad json"
    assert storage.load_json("prices.json")["2001"]["price"] == 12.5
