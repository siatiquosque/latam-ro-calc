import importlib.util
import json
from pathlib import Path
import sqlite3
import unittest

spec = importlib.util.spec_from_file_location('export_acquisition', Path(__file__).with_name('export-ragnarokdb-acquisition.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SnapshotTest(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.row_factory = sqlite3.Row
        for name in ['items', 'mobs']:
            self.conn.execute(f'CREATE TABLE {name} (id INTEGER, dp_last_update TEXT, last_synced_at TEXT, raw_json TEXT)')
        self.conn.execute('INSERT INTO items VALUES (10, NULL, NULL, ?)', (json.dumps(dict(id=10, aegisName='Item10')),))
        self.conn.execute('INSERT INTO mobs VALUES (20, NULL, NULL, ?)', (json.dumps(dict(id=20, region='LATAM', drops=[
            dict(itemId=10, probability=0.5), dict(itemId=10, probability=None), dict(itemId=99, probability=1)])),))
        self.conn.commit()
        self.conn.execute('PRAGMA query_only=ON')

    def tearDown(self):
        self.conn.close()

    def snapshot(self, ids=None, manual=None):
        return module.select_snapshot(self.conn, ids or [10], manual or [], 'a' * 64, '2026-11-05')

    def test_selects_only_requested_relations_and_keeps_duplicate_slots(self):
        value = self.snapshot()
        self.assertEqual([r['itemId'] for r in value['monsters'][0]['drops']], [10, 10])
        self.assertEqual([r['slot'] for r in value['monsters'][0]['drops']], [0, 1])
        self.assertIsNone(value['monsters'][0]['drops'][1]['probability'])
        self.assertNotIn('name', value['items'][0])

    def test_preserves_source_and_reports_missing_items(self):
        value = self.snapshot([10, 11])
        self.assertEqual(value['missingItems'], [11])
        self.assertEqual(len(value['items'][0]['rawSha256']), 64)

    def test_does_not_mutate_db_and_repeated_export_is_identical(self):
        previous = self.conn.total_changes
        self.assertEqual(self.snapshot(), self.snapshot())
        self.assertEqual(self.conn.total_changes, previous)

    def test_records_provisional_rate_as_annotation_not_api_probability(self):
        value = self.snapshot(manual=[dict(map='map1', mobs=[20], drops={'10': 0.15}, note='provisional')])
        self.assertEqual(value['manualDrops'][0]['provisionalPercent'], 0.15)
        self.assertNotIn('probability', value['manualDrops'][0])

    def test_refuses_an_unbounded_export(self):
        with self.assertRaises(ValueError):
            self.snapshot(list(range(1, 258)))


if __name__ == '__main__':
    unittest.main()
