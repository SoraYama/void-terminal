"""Probe pending fallback images without rebuilding an otherwise unchanged catalog."""
import json
from pathlib import Path
import sys

from knowledge.catalog_enrichment import read_baseline_items
from knowledge.items.asset_fallback import enrich_missing_images


if __name__ == '__main__':
    items = read_baseline_items('/baseline/catalog.sqlite', sys.argv[1])
    result = enrich_missing_images(items, Path('/cache/pathofgenshin'), workers=4)
    print(json.dumps({'newlyVerifiedImages': result['accepted'], 'stillPendingImages': result['retry']}))
