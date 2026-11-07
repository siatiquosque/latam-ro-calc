"""Read-only export of every monster drop RagnarokDB holds for items and monsters the calculator knows.

Writes the columnar table the acquisition queries expand into routes (data/acquisition/drops.v1.json).
Uses the same connection/lock as export-ragnarokdb-acquisition.py and never syncs APIs or writes the database.
Manual drop relations stay in the catalog: they carry curation notes, not API facts.
"""
import argparse
from datetime import date
import hashlib
import json
from pathlib import Path
import sys

CHANNELS = [('drops', 0), ('mvpDrops', 1), ('mapSpecificDrops', 2)]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def valid_fraction(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value <= 1 else None


def select_drops(conn, item_ids, monster_ids, producer_version, retrieved_on):
    items, monsters = set(item_ids), set(monster_ids)
    rows, maps, latam = [], {}, []
    for row in conn.execute('SELECT id, raw_json FROM mobs ORDER BY id'):
        if row['id'] not in monsters or not row['raw_json']:
            continue
        raw = json.loads(row['raw_json'])
        if raw.get('id') != row['id']:
            continue
        found = False
        for field, channel in CHANNELS:
            for slot, entry in enumerate(raw.get(field) or []):
                if entry.get('itemId') not in items:
                    continue
                found = True
                map_name = entry.get('mapName')
                if map_name is not None:
                    maps.setdefault(map_name, len(maps))
                rows.append((entry['itemId'], row['id'], channel, slot, map_name,
                             # Map-specific probability has no verified unit and a value outside [0,1] is invalid;
                             # the snapshot importer keeps both as unknown, so does this table.
                             None if channel == 2 else valid_fraction(entry.get('probability')),
                             entry.get('minQuantity'), entry.get('maxQuantity')))
        if found and raw.get('region') == 'LATAM' and 'LATAM' in (raw.get('availableServers') or []):
            latam.append(row['id'])
    rows.sort(key=lambda r: (r[0], r[1], r[2], r[3]))
    names = sorted(maps)
    index = {name: i for i, name in enumerate(names)}
    columns = dict(
        latamMonsters=latam, maps=names,
        item=[r[0] for r in rows], monster=[r[1] for r in rows], slot=[r[3] for r in rows], probability=[r[5] for r in rows],
        channels=[[i, r[2]] for i, r in enumerate(rows) if r[2]],
        mapRows=[[i, index[r[4]]] for i, r in enumerate(rows) if r[4] is not None],
        quantities=[[i, r[6], r[7]] for i, r in enumerate(rows) if r[6] is not None or r[7] is not None])
    sha = digest(json.dumps(columns, sort_keys=True, separators=(',', ':')).encode())
    source = dict(
        id=f"rdb-drops-{producer_version[:8]}-{sha[:12]}", url='https://www.divine-pride.net/database/monster',
        via='RagnarokDB raw_json (read-only snapshot)', retrievedOn=retrieved_on, sha256=sha,
        version=f'producer={producer_version}; columns={sha}',
        license='Third-party Divine Pride/Gravity data; redistribution license unconfirmed',
        locator='mobs.raw_json drops/mvpDrops/mapSpecificDrops for calculator-known items and monsters')
    return dict(source=source, **columns)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True, type=Path)
    parser.add_argument('--assets', required=True, type=Path, help='directory with latam-items.json, item.json, monster.json, latam-monsters.json')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if not (args.project / 'db.py').is_file():
        parser.error('Project must contain db.py')
    load = lambda name: json.loads((args.assets / name).read_text(encoding='utf-8'))
    item_ids = {int(k) for k in load('latam-items.json')} | {r['id'] for r in load('item.json').values()}
    monster_ids = {r['id'] for r in load('monster.json').values()} | {int(k) for k in load('latam-monsters.json')}
    sys.path.insert(0, str(args.project.resolve()))
    import db
    producer = digest(b''.join((args.project / name).read_bytes() for name in ['schema.sql', 'sync.py', 'dp.py']))
    conn = db.connect()
    try:
        conn.execute('PRAGMA query_only=ON')
        conn.execute('BEGIN')
        table = select_drops(conn, item_ids, monster_ids, producer, date.today().isoformat())
    finally:
        conn.close()
    if args.output.exists() and json.loads(args.output.read_text(encoding='utf-8'))['source']['sha256'] == table['source']['sha256']:
        print('Drops unchanged')
        return
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + '.tmp')
    temporary.write_text(json.dumps(table, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8', newline='\n')
    temporary.replace(args.output)
    print(f"{len(table['item'])} drops, {len(set(table['item']))} items, {len(set(table['monster']))} monsters, {len(table['latamMonsters'])} LATAM monsters")


if __name__ == '__main__':
    main()
