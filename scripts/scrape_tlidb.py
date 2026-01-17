"""
One-time scraper to extract item IDs and names from tlidb.com

Extracts data from <a data-hover="?s=ItemBase%2F{ID}"> tags
where the ID is embedded in the data-hover attribute and the
item name is the link text.
"""

import json
import re
import time
from pathlib import Path
from urllib.parse import unquote

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://tlidb.com"
LANG = "en"


def get_soup(url: str) -> BeautifulSoup:
    """Fetch a page and return BeautifulSoup object."""
    print(f"  Fetching: {url}")
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    time.sleep(0.3)  # Be nice to the server
    return BeautifulSoup(response.text, "html.parser")


def get_stash_categories() -> list[str]:
    """
    Get all item categories from the Stash section on the homepage.

    Finds the <div class="card-header">Stash</div> and extracts all
    links from the associated card body.
    """
    soup = get_soup(f"{BASE_URL}/{LANG}/")
    categories = []

    # Find the Stash card header
    stash_header = soup.find("div", class_="card-header", string=re.compile(r"Stash", re.I))

    if not stash_header:
        print("  Warning: Could not find Stash section, using fallback")
        return []

    # The card body should be a sibling of the header
    # Navigate to parent card and find card-body
    card = stash_header.find_parent("div", class_="card")
    if card:
        card_body = card.find("div", class_="card-body")
        if card_body:
            for link in card_body.find_all("a", href=True):
                href = link["href"]
                # Clean up href - remove leading slash or /en/
                if href.startswith(f"/{LANG}/"):
                    href = href[len(f"/{LANG}/"):]
                elif href.startswith("/"):
                    href = href[1:]
                if href and not href.startswith("http"):
                    categories.append(href)

    return categories


def extract_items_from_page(soup: BeautifulSoup) -> dict[str, str]:
    """
    Extract item IDs and names from a page.

    Looks for: <a data-hover="?s=ItemBase%2F{ID}">{Name}</a>
    Returns: {item_id: item_name}
    """
    items = {}

    # Find all <a> tags with data-hover containing ItemBase
    for link in soup.find_all("a", attrs={"data-hover": True}):
        data_hover = link.get("data-hover", "")

        # Check if it's an ItemBase reference
        if "ItemBase" in data_hover:
            # Decode URL encoding: %2F -> /
            decoded = unquote(data_hover)
            # Extract ID from pattern like "?s=ItemBase/100200"
            match = re.search(r'ItemBase/(\d+)', decoded)
            if match:
                item_id = match.group(1)
                item_name = link.get_text(strip=True)
                if item_id and item_name:
                    items[item_id] = item_name

    return items


def scrape_category(category: str) -> dict[str, str]:
    """Scrape all items from a category page."""
    try:
        soup = get_soup(f"{BASE_URL}/{LANG}/{category}")
        return extract_items_from_page(soup)
    except requests.HTTPError as e:
        print(f"    Error fetching {category}: {e}")
        return {}


def main():
    print("Starting tlidb.com scraper...")
    print("=" * 50)

    all_items = {}

    # Get categories dynamically from the Stash section
    print("\nDiscovering categories from Stash section...")
    categories = get_stash_categories()
    print(f"  Found {len(categories)} categories")

    print("\nScraping categories...")
    for category in categories:
        items = scrape_category(category)
        print(f"    {category}: {len(items)} items")
        all_items.update(items)

    print(f"\n  Total unique items: {len(all_items)}")

    # Save results
    output_path = Path(__file__).parent.parent / "data" / "item_ids.json"
    output_path.parent.mkdir(exist_ok=True)

    # Sort by item ID for easier reading
    sorted_items = dict(sorted(all_items.items(), key=lambda x: int(x[0])))

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(sorted_items, f, indent=2, ensure_ascii=False)

    print(f"\nSaved to: {output_path}")
    print("=" * 50)

    # Show a sample
    print("\nSample items:")
    for i, (item_id, name) in enumerate(sorted_items.items()):
        if i >= 10:
            print("  ...")
            break
        print(f"  {item_id}: {name}")


if __name__ == "__main__":
    main()
