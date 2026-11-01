"""
Adds a pool confirmed in game (or read from a regional page) to data/random-options/regional-pools.json, in the shared
document format: the pool is written once as a combiner and the items point at it, so a pool that two items share is
never duplicated. The profiles come from the `pool.profiles` of the MCP tool `uncatalogued_pools` (draft) after you
checked and corrected the ranges in game.

  python tools/add-regional-pool.py 15391,15392 profiles.json --source "no jogo, 05/11/2026" --confidence "visto no jogo"
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from pool_document import dump, load, put  # noqa: E402

PATH = 'data/random-options/regional-pools.json'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('items', help='item ids, comma separated')
    parser.add_argument('profiles', help='JSON file: [{"combiner": "...", "positions": [[{"key","min","max"}]]}]')
    parser.add_argument('--source', required=True)
    parser.add_argument('--confidence', required=True)
    args = parser.parse_args()
    document = load(PATH)
    for profile in json.loads(Path(args.profiles).read_text(encoding='utf8')):
        put(document, [int(i) for i in args.items.split(',')], profile['combiner'], profile['positions'], args.source, args.confidence)
    dump(PATH, document)
    print(f'{len(document["combiners"])} combinadores, {len(document["items"])} itens')


if __name__ == '__main__':
    main()
