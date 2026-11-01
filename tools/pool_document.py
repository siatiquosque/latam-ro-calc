"""
The one format every random-bonus pool file uses, whatever its source (regional, bROWiki, rAthena):

  {
    "_readme": "...", "source": "...", "confidence": "...",          # defaults for every combiner
    "combiners": [ {"name": "Turbulência do Dragão", "source"?: "...", "confidence"?: "...",
                    "positions": [ [ [key, min, max], ... ], ... ] } ],  # one entry per distinct pool, written once
    "items": { "15391": [0, 1], ... }                                  # item id -> indexes of the combiners it rolls
  }

A pool shared by many items (the six Cotas Dracônicas, the four capes) is stored once and pointed at, so no source
duplicates a pool and the app downloads each one a single time. src/app/core/random-option-catalog.ts reads it.

  from pool_document import load, dump, put, drop_owned
"""
import json
from pathlib import Path


def load(path):
    return json.loads(Path(path).read_text(encoding='utf8'))


def rules_of(positions):
    """Positions as [[key, min, max], ...] whether the caller has dicts ({"key", "min", "max"}) or tuples."""
    return [[[r['key'], r['min'], r['max']] if isinstance(r, dict) else list(r) for r in position] for position in positions]


def put(document, item_ids, name, positions, source=None, confidence=None):
    """Point `item_ids` at the combiner (name, positions, source, confidence), creating it only if it is new."""
    entry = {'name': name, **({'source': source} if source else {}), **({'confidence': confidence} if confidence else {}),
             'positions': rules_of(positions)}
    combiners = document['combiners']
    index = next((i for i, c in enumerate(combiners) if c == entry), None)
    if index is None:
        combiners.append(entry)
        index = len(combiners) - 1
    for item in item_ids:
        rolling = document['items'].setdefault(str(item), [])
        if index not in rolling:
            rolling.append(index)
    return index


def drop_owned(document, marker):
    """Remove every combiner whose source contains `marker` (and the items that only pointed at those), keeping the rest."""
    keep = [i for i, c in enumerate(document['combiners']) if marker not in c.get('source', '')]
    renumber = {old: new for new, old in enumerate(keep)}
    document['combiners'] = [document['combiners'][i] for i in keep]
    items = {}
    for item, rolling in document['items'].items():
        kept = [renumber[i] for i in rolling if i in renumber]
        if kept:
            items[item] = kept
    document['items'] = items


def dump(path, document):
    """One combiner per line and one item per line: diffable, and compact since the file ships to the browser."""
    def line(value):
        return json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    head = {k: v for k, v in document.items() if k not in ('combiners', 'items', 'unmapped')}
    parts = [f' {json.dumps(k)}: {line(v)}' for k, v in head.items()]
    parts.append(' "combiners": [\n' + ',\n'.join('  ' + line(c) for c in document['combiners']) + '\n ]')
    items = sorted(document['items'].items(), key=lambda kv: int(kv[0]))
    parts.append(' "items": {\n' + ',\n'.join(f'  {json.dumps(k)}: {line(v)}' for k, v in items) + '\n }')
    if document.get('unmapped'):
        parts.append(f' "unmapped": {line(document["unmapped"])}')
    Path(path).write_text('{\n' + ',\n'.join(parts) + '\n}\n', encoding='utf8')
