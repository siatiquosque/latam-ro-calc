"""Run: python tools/import-acquisition.spec.py (no network)."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('import_acquisition', Path(__file__).with_name('import-acquisition.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

ITEMS = {str(i): dict(id=i, aegisName=name) for i, name in enumerate(['Trigger', 'Input', 'Output', 'Ore', 'Enchant1', 'Enchant2'], 1)}
REFORM = '''Header: {Type: ITEM_REFORM_DB, Version: 1}
Body:
  - Item: Trigger
    BaseItems:
      - BaseItem: Input
        MinimumRefine: 7
        MaximumRefine: 10
        Materials: [{Material: Ore, Amount: 3}]
        ResultItem: Output
        ChangeRefine: -2
        ClearSlots: true
        RemoveEnchantgrade: true
'''
ENCHANT = '''Header: {Type: ITEM_ENCHANT_DB, Version: 1}
Body:
  - Id: 2
    TargetItems: {Input: true}
    MinimumRefine: 7
    Slots:
      - Slot: 1
        Upgrades:
          - Enchant: Enchant1
            Upgrade: Enchant2
            Price: 100
            Materials: [{Material: Ore}]
'''


class ExtractionTest(unittest.TestCase):
    def extract(self, text=REFORM, kind='reform', select=None, items=ITEMS):
        return module.extract(text, kind, select or (['Trigger'] if kind == 'reform' else ['2']), items, 'a' * 40, '2026-11-05')

    def test_reform_preserves_restrictions_and_result(self):
        result = self.extract()
        route = result['routes'][0]
        self.assertEqual(route['target']['itemIds'], [3])
        self.assertEqual(route['review'], 'unreviewed')
        self.assertEqual(route['server'], 'generic')
        self.assertEqual(route['result']['cards'], 'cleared')
        self.assertEqual(route['result']['grade'], 'removed')
        self.assertEqual(route['requirements'][1]['minRefine'], 7)
        self.assertIn('"MaximumRefine": 10', route['requirements'][1]['description'])
        self.assertEqual(len(result['sources'][0]['sha256']), 64)

    def test_enchant_preserves_source_target_and_slot(self):
        route = self.extract(ENCHANT, 'enchant')['routes'][0]
        self.assertEqual(route['target']['position'], 1)
        self.assertEqual(route['target']['enchantIds'], [6])
        self.assertEqual(route['cost']['zeny'], 100)
        self.assertTrue(any(r['itemId'] == 5 for r in route['requirements']))
        self.assertTrue(any(r['itemId'] == 4 and r['amount'] == 1 for r in route['requirements']))

    def test_rejects_unknown_version_or_fields(self):
        for text in [REFORM.replace('Version: 1', 'Version: 2'), REFORM.replace('MinimumRefine: 7', 'UnknownRestriction: 7')]:
            with self.assertRaises(ValueError):
                self.extract(text)

    def test_rejects_unresolved_or_ambiguous_identity(self):
        with self.assertRaises(ValueError):
            self.extract(items={})
        with self.assertRaises(ValueError):
            self.extract(items={**ITEMS, '100': dict(id=100, aegisName='Input')})

    def test_selection_is_mandatory_and_narrow(self):
        with self.assertRaises(ValueError):
            self.extract(select=['Missing'])
        self.assertEqual(len(self.extract()['routes']), 1)

    def test_normal_random_draws_are_not_silently_imported(self):
        with self.assertRaises(ValueError):
            self.extract(ENCHANT.replace('Upgrades:', 'Enchants:').replace('Enchant: Enchant1', 'Item: Enchant1'), 'enchant')

    def test_enchant_filter_never_falls_back_to_all_operations(self):
        result = module.extract(ENCHANT, 'enchant', ['2'], ITEMS, 'a' * 40, '2026-11-05', ['Enchant2'])
        self.assertEqual(len(result['routes']), 1)
        with self.assertRaises(ValueError):
            module.extract(ENCHANT, 'enchant', ['2'], ITEMS, 'a' * 40, '2026-11-05', ['Unknown'])

    def test_checked_in_real_extractions_remain_unreviewed(self):
        for path in Path('data/acquisition').glob('rathena*json'):
            result = json.loads(path.read_text(encoding='utf-8'))
            self.assertTrue(all(r['review'] == 'unreviewed' and r['server'] == 'generic' and r['supersedes'] is None for r in result['routes']))

    def test_cli_refuses_to_overwrite_and_preserves_identity_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'input.yml').write_text(REFORM, encoding='utf-8')
            (root / 'items.json').write_text(json.dumps(ITEMS), encoding='utf-8')
            (root / 'client.json').write_text('{}', encoding='utf-8')
            output = root / 'candidate.json'
            args = [sys.executable, str(Path(__file__).with_name('import-acquisition.py')), '--kind', 'reform',
                    '--input', str(root / 'input.yml'), '--items', str(root / 'items.json'), '--client', str(root / 'client.json'),
                    '--select', 'Trigger', '--revision', 'a' * 40, '--retrieved-on', '2026-11-05', '--output', str(output)]
            first = subprocess.run(args, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            contents = output.read_bytes()
            self.assertEqual(len(json.loads(contents)['sources']), 3)
            self.assertNotEqual(subprocess.run(args, capture_output=True).returncode, 0)
            self.assertEqual(output.read_bytes(), contents)


if __name__ == '__main__':
    unittest.main()
