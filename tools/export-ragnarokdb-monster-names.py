#!/usr/bin/env python3
"""Export explicit PT-BR translations for the calculator's existing monster IDs.

Usage: python tools/export-ragnarokdb-monster-names.py --project D:/Developer/RagnarokDB
Uses RagnarokDB's own connection/lock; does not fetch APIs or modify the database.
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path, required=True, help='RagnarokDB project containing db.py')
    args = parser.parse_args()
    project = args.project.resolve()
    if not (project / 'db.py').is_file():
        parser.error('The RagnarokDB project must contain db.py')
    sys.path.insert(0, str(project))
    import db

    monsters = json.loads((ROOT / 'src/assets/demo/data/monster.json').read_text(encoding='utf-8'))
    conn = db.connect()
    try:
        conn.execute('PRAGMA query_only=ON')
        names = {str(row['id']): row['name_ptbr'].strip() for row in conn.execute(
            "SELECT id, name_ptbr FROM mobs WHERE name_ptbr IS NOT NULL AND trim(name_ptbr) <> '' ORDER BY id"
        ) if str(row['id']) in monsters}
    finally:
        conn.close()
    if not names:
        raise SystemExit('No explicit PT-BR names found; existing export was preserved.')
    output = ROOT / 'data/monsters/ragnarokdb-names.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(names, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{len(names)} explicit PT-BR names exported to {output.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
