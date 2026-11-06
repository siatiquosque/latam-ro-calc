"""Selective read-only snapshot of RagnarokDB acquisition fields; never syncs APIs.

Uses the same connection/lock as export-ragnarokdb-monster-names.py. Names, stats,
scripts, prices and other catalog records are not exported/replaced.
"""
import argparse
from datetime import date
import hashlib
import json
from pathlib import Path
import sys


def digest(data):
    return hashlib.sha256(data).hexdigest()


def select_snapshot(conn, item_ids, manual, producer_version, retrieved_on):
    wanted = set(item_ids)
    if not wanted or len(wanted) > 256 or any(type(i) is not int or i <= 0 for i in wanted):
        raise ValueError('Select 1..256 explicit positive item IDs')
    snapshot = dict(schemaVersion=1, producerVersion=producer_version, retrievedOn=retrieved_on,
                    itemIds=sorted(wanted), items=[], monsters=[], manualDrops=[], missingItems=[])
    for item_id in sorted(wanted):
        row = conn.execute('SELECT id, dp_last_update, last_synced_at, raw_json FROM items WHERE id=?', (item_id,)).fetchone()
        if not row or not row['raw_json']:
            snapshot['missingItems'].append(item_id)
            continue
        raw = json.loads(row['raw_json'])
        reform = (raw.get('reformUsage') or {}).get('asBaseItem') or []
        snapshot['items'].append(dict(id=item_id, rawId=raw.get('id'), aegisName=raw.get('aegisName'),
            region=raw.get('region'), availableServers=raw.get('availableServers') or [],
            dpLastUpdate=row['dp_last_update'], lastSyncedAt=row['last_synced_at'], rawSha256=digest(row['raw_json'].encode()),
            reforms=[{k: r.get(k) for k in ['infoId', 'toolItemId', 'baseItemId', 'resultItemId', 'needRefineMin', 'needRefineMax',
                'needOptionNumMin', 'isEmptySocket', 'changeRefineValue', 'preserveSocketItem', 'preserveGrade', 'randomOptionCode']}
                | dict(materials=[dict(itemId=m.get('itemId'), amount=m.get('amount')) for m in r.get('materials') or []]) for r in reform],
            references=dict(enchantIds=sorted({e['enchantId'] for e in raw.get('enchantSystems') or []}),
                extractionToolIds=sorted({e['itemId'] for e in raw.get('lapineDdukdakSources') or []}),
                containerIds=sorted({e['sourceId'] for e in raw.get('containedIn') or []}))))
    for row in conn.execute('SELECT id, dp_last_update, last_synced_at, raw_json FROM mobs ORDER BY id'):
        if not row['raw_json']:
            continue
        raw = json.loads(row['raw_json'])
        drops = []
        for field, channel in [('drops', 'normal'), ('mvpDrops', 'mvp'), ('mapSpecificDrops', 'map')]:
            for slot, entry in enumerate(raw.get(field) or []):
                if entry.get('itemId') in wanted:
                    drops.append(dict(itemId=entry['itemId'], slot=slot, channel=channel, map=entry.get('mapName'),
                        probability=entry.get('probability'), minQuantity=entry.get('minQuantity'), maxQuantity=entry.get('maxQuantity')))
        if drops:
            snapshot['monsters'].append(dict(id=row['id'], rawId=raw.get('id'), region=raw.get('region'),
                availableServers=raw.get('availableServers') or [], dpLastUpdate=row['dp_last_update'], lastSyncedAt=row['last_synced_at'],
                rawSha256=digest(row['raw_json'].encode()), drops=drops))
    for entry in manual:
        for item_id, rate in sorted(entry.get('drops', {}).items(), key=lambda pair: int(pair[0])):
            if int(item_id) in wanted:
                for monster_id in sorted(entry['mobs']):
                    snapshot['manualDrops'].append(dict(itemId=int(item_id), monsterId=monster_id, map=entry['map'],
                        provisionalPercent=rate, note=entry.get('note', ''), sourceSha256=digest(json.dumps(entry, sort_keys=True, ensure_ascii=False).encode())))
    return snapshot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True, type=Path)
    parser.add_argument('--scope', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if not (args.project / 'db.py').is_file():
        parser.error('Project must contain db.py')
    sys.path.insert(0, str(args.project.resolve()))
    import db
    scope = json.loads(args.scope.read_text(encoding='utf-8'))
    if scope.get('schemaVersion') != 1:
        parser.error('Unsupported scope version')
    manual = json.loads((args.project / 'manual_drops.json').read_text(encoding='utf-8'))
    producer = digest(b''.join((args.project / name).read_bytes() for name in ['schema.sql', 'sync.py', 'dp.py']))
    conn = db.connect()
    try:
        conn.execute('PRAGMA query_only=ON')
        conn.execute('BEGIN')
        snapshot = select_snapshot(conn, scope['itemIds'], manual, producer, date.today().isoformat())
    finally:
        conn.close()
    contents = json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n'
    if args.output.exists() and args.output.read_text(encoding='utf-8') == contents:
        print('Snapshot unchanged')
        return
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Output belongs to this exporter, not the internal catalog. A complete temporary
    # file is replaced atomically; the source database is never written.
    temporary = args.output.with_suffix(args.output.suffix + '.tmp')
    temporary.write_text(contents, encoding='utf-8', newline='\n')
    temporary.replace(args.output)
    print(f"{len(snapshot['items'])} items, {len(snapshot['monsters'])} monsters, {len(snapshot['manualDrops'])} manual relations exported")


if __name__ == '__main__':
    main()
