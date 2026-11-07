import importlib.util
import json
from pathlib import Path
import sqlite3
import unittest

spec = importlib.util.spec_from_file_location('export_drops', Path(__file__).with_name('export-ragnarokdb-drops.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DropsTest(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.row_factory = sqlite3.Row
        self.conn.execute('CREATE TABLE mobs (id INTEGER, raw_json TEXT)')
        mobs = [
            dict(id=20, region='LATAM', availableServers=['LATAM'], drops=[
                dict(itemId=10, probability=0.5), dict(itemId=10, probability=7), dict(itemId=99, probability=1)],
                mvpDrops=[dict(itemId=11, probability=0.01)],
                mapSpecificDrops=[dict(itemId=10, probability=0.2, mapName='prt_fild08', minQuantity=1, maxQuantity=2)]),
            dict(id=21, region='LATAM', availableServers=['kROM'], drops=[dict(itemId=10, probability=0.1)]),
            dict(id=22, region='LATAM', availableServers=['LATAM'], drops=[dict(itemId=10, probability=0.1)]),
        ]
        for mob in mobs:
            self.conn.execute('INSERT INTO mobs VALUES (?, ?)', (mob['id'], json.dumps(mob)))

    def tearDown(self):
        self.conn.close()

    def table(self):
        return module.select_drops(self.conn, [10, 11], [20, 21], 'p' * 64, '2026-11-07')

    def test_keeps_slots_channels_and_only_known_items_and_monsters(self):
        t = self.table()
        self.assertEqual(t['item'], [10, 10, 10, 10, 11])
        self.assertEqual(t['monster'], [20, 20, 20, 21, 20])
        self.assertEqual(t['channels'], [[2, 2], [4, 1]])
        self.assertEqual(t['slot'], [0, 1, 0, 0, 0])

    def test_unverified_probabilities_become_null(self):
        t = self.table()
        self.assertEqual(t['probability'], [0.5, None, None, 0.1, 0.01])
        self.assertEqual(t['maps'], ['prt_fild08'])
        self.assertEqual(t['mapRows'], [[2, 0]])
        self.assertEqual(t['quantities'], [[2, 1, 2]])

    def test_latam_monsters_need_region_and_server_list(self):
        self.assertEqual(self.table()['latamMonsters'], [20])

    def test_source_hash_is_stable_and_tracks_content(self):
        first = self.table()['source']
        self.assertEqual(first['sha256'], self.table()['source']['sha256'])
        self.conn.execute("UPDATE mobs SET raw_json = replace(raw_json, '0.1', '0.2') WHERE id = 21")
        self.assertNotEqual(first['sha256'], self.table()['source']['sha256'])


if __name__ == '__main__':
    unittest.main()
