"""Run: python tools/build-browiki-acquisition.spec.py (no network; uses a minimal synthetic Automatron page)."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('build_browiki', Path(__file__).with_name('build-browiki-acquisition.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

LIMITS = '<td>x1</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>'


def link(item_id, label):
    return f'<a href="http://www.divine-pride.net/database/item/{item_id}/">{label}</a>'


def page(h_rows):
    return f'''<html><head><script>RLCONF={{"wgRevisionId":7}}</script></head><body><table>
<tr><td>{link(450128, 'Colete Automatron A')}</td><td>{link(15000, '+9 Base')}</td><td>10</td></tr>
<tr><td><img alt="1000100.png"> Automódulo de B-FOR</td><td>{link(310001, 'B-FOR')}</td><td>FOR +5</td>{LIMITS}</tr>
<tr><th colspan="12">H- Habilidade</th></tr>
{h_rows}
</table></body></html>'''


H_OK = f'''<tr><td><img alt="1000152.png"> Automódulo de H-Dragão</td><td>{link(310127, 'H-Dragão')}</td><td>Sopro</td><td>x2</td><td rowspan="2">Cavaleiros Rúnicos</td></tr>
<tr><td><img alt="1000153.png"> Automódulo de H-Rúnico</td><td>{link(310128, 'H-Rúnico')}</td><td>Onda</td><td>x1</td></tr>'''


def build(html):
    with tempfile.TemporaryDirectory() as tmp:
        Path(tmp, module.PAGES['automatron'][0]).write_text(html, encoding='utf8')
        return module.automatron(tmp, 'browiki-automatron-7')


class BuildBrowiki(unittest.TestCase):
    def test_h_modules_share_the_exchange_route_and_keep_class_and_limit(self):
        routes, modules = build(page(H_OK))
        exchange = [r for r in routes if r['method'] == 'exchange' and r['id'] == 'automatron-module-exchange-v1']
        self.assertEqual(len(exchange), 1)
        self.assertEqual([o['itemId'] for o in exchange[0]['outputs']], [1000100, 1000152, 1000153])
        self.assertTrue(all(o['chance'] is None for o in exchange[0]['outputs']), 'no uniform weights')
        self.assertEqual(modules[1000153]['classes'], 'Cavaleiros Rúnicos', 'rowspan class reaches the second row')
        h = [r for r in routes if r['id'].startswith('automatron-enchant-310128-')]
        self.assertEqual(sorted(r['target']['position'] for r in h), [1, 2, 3])
        self.assertTrue(all(r['target']['itemIds'] == [450127, 450128] for r in h), 'Colete only')
        self.assertTrue(any('Cavaleiros Rúnicos' in q['description'] for q in h[0]['requirements']))

    def test_generation_is_deterministic_and_availability_stays_unconfirmed(self):
        first, second = build(page(H_OK)), build(page(H_OK))
        self.assertEqual(json.dumps(first, sort_keys=True), json.dumps(second, sort_keys=True))
        for r in first[0]:
            self.assertFalse(r['period']['known'])
            self.assertEqual(r['review'], 'reviewed')
            self.assertEqual(r['sources'], ['browiki-automatron-7'])
            self.assertTrue(r['unknowns'])
        self.assertEqual(len({r['id'] for r in first[0]}), len(first[0]), 'no duplicate ids')

    def test_h_module_without_a_class_cell_is_refused(self):
        orphan = f'<tr><td><img alt="1000152.png"> Automódulo de H-Dragão</td><td>{link(310127, "H-Dragão")}</td><td>Sopro</td><td>x2</td></tr>'
        with self.assertRaises(SystemExit):
            build(page(orphan))


if __name__ == '__main__':
    unittest.main()
