"""
Reads the bROWiki page "Bônus Aleatórios" (saved HTML) and writes data/random-options/browiki-pools.json: the pool
of every item that a combiner rolls, per position, in the shape random-option-catalog.ts uses.

The page names every item through its divine-pride link, so items are matched by id, never by name. Rule texts are
translated to calculator keys by an explicit table (RULES); a text it does not know is recorded under `unmapped`
and left out of the pool, never guessed. Reference ranges from a community wiki, not measured on LATAM.

  curl -sL -A "Mozilla/5.0" "https://browiki.org/wiki/B%C3%B4nus_Aleat%C3%B3rios" -o .scratch/browiki/bonus-aleatorios.html
  python tools/import-browiki-pools.py --html .scratch/browiki/bonus-aleatorios.html
"""
import argparse
import html
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from pool_document import dump  # noqa: E402

URL = 'https://browiki.org/wiki/B%C3%B4nus_Aleat%C3%B3rios'
RACES = ['formless', 'undead', 'brute', 'plant', 'insect', 'fish', 'demon', 'demihuman', 'angel', 'dragon']
ELEMENTS = ['neutral', 'water', 'earth', 'fire', 'wind', 'poison', 'holy', 'dark', 'ghost', 'undead']
SIZES = ['s', 'm', 'l']
CLASSES = ['normal', 'boss']


def plain(text: str) -> str:
    text = unicodedata.normalize('NFKD', html.unescape(text))
    text = ''.join(c for c in text if not unicodedata.combining(c))
    return re.sub(r'\s+', ' ', text).strip().lower()


# label (no accents, lower case, placeholders as tokens) -> (key when plain, key when percent) or a template.
SIMPLE = {
    'hp max.': ('hp', 'hpPercent'), 'sp max.': ('sp', 'spPercent'),
    'atq': ('atk', 'atkPercent'), 'atqm': ('matk', 'matkPercent'),
    'dano fisico': ('atkPercent', 'atkPercent'), 'dano magico': ('matkPercent', 'matkPercent'),
    'velocidade de ataque': ('aspd', 'aspdPercent'), 'precisao': ('hit', 'hit'), 'esquiva': ('flee', 'flee'),
    'crit': ('cri', 'cri'), 'dano critico': ('criDmg', 'criDmg'),
    'dano fisico a distancia': ('range', 'range'), 'dano fisico corpo a corpo': ('melee', 'melee'),
    'efetividade de cura': ('healPower', 'healPower'), 'conjuracao variavel': ('vct', 'vct'),
    'pos-conjuracao': ('acd', 'acd'), 'def': ('def', 'def'), 'defm': ('mdef', 'mdef'),
    'tenacidade': ('res', 'res'), 'tenacidade magica': ('mres', 'mres'),
    'for': ('str', 'str'), 'agi': ('agi', 'agi'), 'vit': ('vit', 'vit'), 'int': ('int', 'int'),
    'des': ('dex', 'dex'), 'sor': ('luk', 'luk'), 'pod': ('pow', 'pow'), 'sab': ('wis', 'wis'),
    'sta': ('sta', 'sta'), 'fei': ('spl', 'spl'), 'con': ('con', 'con'), 'crv': ('crt', 'crt'),
    'p.atq': ('pAtk', 'pAtk'), 's.atqm': ('sMatk', 'sMatk'), 'c.rate': ('cRate', 'cRate'),
    'esquiva perfeita': ('perfectDodge', 'perfectDodge'), 'cura recebida': ('healReceived', 'healReceived'),
    'todos os atributos': ('allStatus', 'allStatus'),
    'dano fisico contra monstros normais': ('p_class_normal', 'p_class_normal'),
    'dano fisico contra monstros chefes': ('p_class_boss', 'p_class_boss'),
    'dano magico contra monstros normais': ('m_class_normal', 'm_class_normal'),
    'dano magico contra monstros chefes': ('m_class_boss', 'm_class_boss'),
    'consumo de sp': ('spCostPercent', 'spCostPercent'),
    'ten': ('res', 'res'), 'tenm': ('mres', 'mres'),
    'dano magico de todas as propriedades': ('m_my_element_all', 'm_my_element_all'),
}
ELEMENT_NAMES = {'neutro': 'neutral', 'agua': 'water', 'terra': 'earth', 'fogo': 'fire', 'vento': 'wind', 'veneno': 'poison',
                 'sagrado': 'holy', 'sombrio': 'dark', 'fantasma': 'ghost', 'maldito': 'undead'}
# Placeholder rules: prefix of the calculator key, and the members that [RAÇA] / [PROP.] / [TAMANHO] expand to.
PLACEHOLDER = [
    (r'^dano fisico contra (?:oponentes )?\[raca\]$', 'p_race_', RACES),
    (r'^dano magico contra (?:oponentes )?\[raca\]$', 'm_race_', RACES),
    (r'^dano fisico contra (?:oponentes (?:de )?)?\[prop\.?\]$', 'p_element_', ELEMENTS),
    (r'^dano magico contra (?:oponentes (?:de )?)?\[prop\.?\]$', 'm_element_', ELEMENTS),
    (r'^dano magico de (?:propriedade )?\[prop\.?\]$', 'm_my_element_', ELEMENTS),
    (r'^\[atributo\]$', '', ['str', 'agi', 'vit', 'int', 'dex', 'luk']),
    (r'^dano fisico contra (?:oponentes )?\[tamanho\]$', 'p_size_', SIZES),
    (r'^dano magico contra (?:oponentes )?\[tamanho\]$', 'm_size_', SIZES),
    (r'^resistencia a \[raca\]$', 'subrace_', RACES),
    (r'^resistencia a \[prop\.?\]$', 'subele_', ELEMENTS),
]
RULE = re.compile(r'^(?P<label>.+?)\s*(?P<sign>[+-])?\s*(?P<min>\d[\d.]*)(?:\s*~\s*(?P<max>\d[\d.]*))?\s*(?P<pct>%)?\.?$')


def number(raw: str) -> int:
    """Thousands use a dot on this page ("2.000"); the values are whole numbers."""
    return int(raw.replace('.', ''))


def translate(text: str):
    """(rules, reason): the calculator rules a wiki line stands for, or why there are none."""
    match = RULE.match(text.strip())
    if not match:
        return [], 'sem valor'
    label = plain(match['label'])
    low, high = number(match['min']), number(match['max'] or match['min'])
    percent = bool(match['pct'])
    for pattern, prefix, members in PLACEHOLDER:
        if re.match(pattern, label):
            return [{'key': prefix + m, 'min': low, 'max': high} for m in members], None
    named = re.match(r'^resistencia a propriedade (\w+)$', label)
    if named and named[1] in ELEMENT_NAMES:
        return [{'key': 'subele_' + ELEMENT_NAMES[named[1]], 'min': low, 'max': high}], None
    if label in SIMPLE:
        return [{'key': SIMPLE[label][1 if percent else 0], 'min': low, 'max': high}], None
    return [], 'sem chave'


class Page(HTMLParser):
    """Collects every combiner: its id and name, then per item group the cells of each rule row."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.section = ''
        self.in_heading = False
        self.depth_stack = []  # table nesting
        self.combiners = []
        self.cell = None
        self.row = None
        self.cell_links = []
        self.cell_text = []
        self.cell_class = ''
        self.heading_text = []
        self.layout = 0  # tables nested inside a cell, used only to lay out its content

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ('h2', 'h3'):
            self.in_heading = True
            self.heading_text = []
        elif tag == 'table' and self.cell and 'wikitable' not in a.get('class', ''):
            self.layout += 1
        elif tag == 'table':
            self.depth_stack.append(a.get('class', ''))
            if 'mw-collapsible' in a.get('class', ''):
                self.combiners.append({'section': self.section, 'id': None, 'name': '', 'groups': [], 'notes': []})
        elif tag == 'tr' and not self.layout:
            self.row = []
        elif tag in ('td', 'th') and not self.layout:
            self.cell = tag
            self.cell_links, self.cell_text, self.cell_class = [], [], a.get('class', '')
        elif tag == 'a' and self.cell:
            m = re.search(r'/database/item/(\d+)/', a.get('href', ''))
            if m:
                self.cell_links.append(int(m[1]))
                self.cell_text.append('\x00')
        elif tag == 'br' and self.cell:
            self.cell_text.append(' ')

    def handle_endtag(self, tag):
        if tag in ('h2', 'h3'):
            self.in_heading = False
            title = ''.join(self.heading_text).strip()
            if title:
                self.section = title
        elif tag == 'table' and self.layout:
            self.layout -= 1
        elif tag in ('td', 'th') and self.cell and not self.layout:
            text = html.unescape(''.join(self.cell_text).replace('\x00', '')).strip()
            self.row.append({'tag': tag, 'class': self.cell_class, 'links': self.cell_links, 'text': re.sub(r'\s+', ' ', text)})
            self.cell = None
        elif tag == 'tr' and self.row is not None and not self.layout:
            self.finish_row(self.row)
            self.row = None
        elif tag == 'table' and self.depth_stack:
            self.depth_stack.pop()

    def handle_data(self, data):
        if self.in_heading:
            self.heading_text.append(re.sub(r'\[.*?\]', '', data))
        if self.cell:
            self.cell_text.append(data)

    def finish_row(self, row):
        if not self.combiners or not row:
            return
        combiner = self.combiners[-1]
        inner = len([c for c in self.depth_stack if 'wikitable' in c]) >= 2
        header = row[0]['tag'] == 'th'
        if header:
            return
        title = row[0]['class'].startswith('table-rh')
        if not inner and title and combiner['id'] is None:
            combiner['id'] = (row[0]['links'] or [None])[0]
            combiner['name'] = row[0]['text']
            return
        if not inner:
            return
        cells = row
        if title:
            combiner['groups'].append({'items': row[0]['links'], 'rows': []})
            cells = row[1:]
        if cells and combiner['groups']:
            combiner['groups'][-1]['rows'].append([c['text'] for c in cells])


def build(page: Page):
    """combiners (each pool written once, rules as [key, min, max]) and which combiners roll on which item."""
    combiners, items = [], defaultdict(list)
    unmapped = Counter()
    for combiner in page.combiners:
        for group in combiner['groups']:
            positions = defaultdict(list)
            for row in group['rows']:
                # cells alternate rule / chance; a short row simply has fewer positions
                for index in range(0, len(row) - 1, 2):
                    rules, reason = translate(row[index])
                    if reason:
                        unmapped[f'{plain(row[index])} [{reason}]'] += 1
                    positions[index // 2].extend(rules)
            ordered = [positions[i] for i in sorted(positions)]
            if not ordered or not group['items']:
                continue
            merged = [[[r['key'], r['min'], r['max']] for r in {(r['key'], r['min'], r['max']): r for r in position}.values()] for position in ordered]
            combiners.append({'name': combiner['name'], 'id': combiner['id'], 'section': combiner['section'], 'positions': merged})
            for item in group['items']:
                items[str(item)].append(len(combiners) - 1)
    return combiners, dict(sorted(items.items(), key=lambda kv: int(kv[0]))), unmapped


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--html', default='.scratch/browiki/bonus-aleatorios.html')
    parser.add_argument('--out', default='data/random-options/browiki-pools.json')
    args = parser.parse_args()
    page = Page()
    page.feed(Path(args.html).read_text(encoding='utf8', errors='replace'))
    combiners, items, unmapped = build(page)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    document = {
        '_readme': 'Gerado por tools/import-browiki-pools.py a partir do bROWiki. Não edite à mão: confirmações do jogo vão em regional-pools.json.',
        'source': URL, 'confidence': 'bROWiki; faixas de referência, não medidas no LATAM', 'combiners': combiners, 'items': items, 'unmapped': dict(unmapped.most_common()),
    }
    dump(args.out, document)
    sys.stdout.reconfigure(encoding='utf-8')
    skipped = sorted({c['name'] for c in page.combiners} - {c['name'] for c in combiners})
    print(f'{len(combiners)} grupos de combinador, {len(items)} itens com pool, {sum(unmapped.values())} linhas sem chave')
    print('combinadores sem itens identificados:', ', '.join(skipped))
    for text, count in unmapped.most_common(15):
        print(f'  {count:3d}  {text}')


if __name__ == '__main__':
    main()
