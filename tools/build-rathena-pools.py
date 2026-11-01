"""
Condenses data/random-options/rathena-audit.json into data/random-options/rathena-pools.json: the pool of every item
that has one in rAthena, in the shape random-option-catalog.ts reads (combiners written once, items point at them).

The audit snapshot is 1.8 MB and only the MCP reads it; this file is small enough for the app, which uses it to
narrow the random-bonus picker of items no regional source covers. The LATAM server tends to follow kRO, which is what
rAthena reproduces, but nothing here is confirmed for LATAM: the catalog ranks it below the code, regional-pools.json
and the bROWiki pools.

  python tools/build-rathena-pools.py
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from pool_document import dump  # noqa: E402


# Items rAthena does not link to a combiner but that the players' wiki/guild confirm roll the same as a sibling:
# the broken fans (Mini Fan-LT, Fur Seal) and the Crimson Booster share the pool of the normal Sea Otter fan and
# Magical Booster K.
SAME_POOL = {28440: 28439, 490374: 28439, 490375: 28439, 19245: 19241}


def pool_of(group, mapping):
    """Positions of one rAthena group: per slot, the options that have a calculator key, as [key, min, max]."""
    positions = []
    for slot in group.get('Slots') or []:
        rules = {}
        for option in slot.get('Options') or []:
            key = (mapping.get(option['Option']) or {}).get('calculatorKey')
            if not key or option.get('MinValue') is None:
                continue
            low, high = option['MinValue'], option.get('MaxValue', option['MinValue'])
            old = rules.get(key)
            rules[key] = [key, min(low, old[1]) if old else low, max(high, old[2]) if old else high]
        positions.append(list(rules.values()))
    return positions


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--audit', default='data/random-options/rathena-audit.json')
    parser.add_argument('--out', default='data/random-options/rathena-pools.json')
    args = parser.parse_args()
    audit = json.loads(Path(args.audit).read_text(encoding='utf8'))
    groups, mapping = audit['groups'], audit['options']
    combiners, index, items = [], {}, {}
    for item_id, item in audit['items'].items():
        for ref in item['references']:
            if not (ref.get('identityMatched') and ref.get('hasRollPool') and ref['group'] in groups):
                continue
            if ref['group'] not in index:
                positions = pool_of(groups[ref['group']], mapping)
                if not any(positions):
                    continue
                index[ref['group']] = len(combiners)
                combiners.append({'name': ref['group'], 'positions': positions})
            items.setdefault(item_id, [])
            if index[ref['group']] not in items[item_id]:
                items[item_id].append(index[ref['group']])
    for alias, original in SAME_POOL.items():
        if str(original) in items and str(alias) not in items:
            items[str(alias)] = list(items[str(original)])
    document = {
        '_readme': 'Gerado por tools/build-rathena-pools.py a partir de rathena-audit.json. Referência do kRO via rAthena, não confirmada no LATAM.',
        'source': f"rAthena {audit['revision']}", 'confidence': 'rAthena (kRO); o LATAM tende a seguir o kRO, mas não está confirmado', 'combiners': combiners,
        'items': dict(sorted(items.items(), key=lambda kv: int(kv[0]))),
    }
    dump(args.out, document)
    print(f'{len(combiners)} grupos, {len(items)} itens com pool')


if __name__ == '__main__':
    main()
