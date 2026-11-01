"""
Reads the bROWiki pages of three instances/dungeons that hand out random-bonus combiners and merges the pools into
data/random-options/regional-pools.json (the tier above the main "Bônus Aleatórios" page and rAthena):

  Lago do Abismo     Cotas/Capa/Bota Dracônicas  (Turbulência, Solidez, Poder, Força do Dragão)
  Torneio de Magia   Traje/Manto Anti-Magia and Anéis de Reforço (Encantador Mágico / Místico de Geffen)
  Arena Noturna      Uniforme/Manto/Sobrepeliz/Casaco, Absorvedor/Enciclopédia and Anéis Condensadores (Adornos)

Items are matched by their divine-pride id on the page, never by name. Rule texts go through the same translator as
tools/import-browiki-pools.py; a line it cannot map to a calculator key (indestructible, armor element...) is listed
under "sem chave" and left out. Reference ranges from a community wiki, not measured on LATAM.

  for p in Lago_do_Abismo Torneio_de_Magia Arena_Noturna; do
    curl -sL -A "Mozilla/5.0" "https://browiki.org/wiki/$p" -o .scratch/browiki/$p.html
  done
  python tools/import-browiki-instances.py
"""
import importlib.util
import json
import re
import sys
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from pool_document import drop_owned, dump, load, put  # noqa: E402

spec = importlib.util.spec_from_file_location('browiki', Path(__file__).with_name('import-browiki-pools.py'))
browiki = importlib.util.module_from_spec(spec)
spec.loader.exec_module(browiki)
plain, translate = browiki.plain, browiki.translate
ELEMENT_NAMES, RACES = browiki.ELEMENT_NAMES, browiki.RACES

PAGES = '.scratch/browiki/{}.html'
OUT = 'data/random-options/regional-pools.json'
OWNED = 'import-browiki-instances'  # marker in `source` of the entries this tool writes, so a rerun replaces only them
TOURNAMENT_ELEMENTS = ['water', 'earth', 'fire', 'wind']  # what [PROPRIEDADE] is on the Torneio de Magia page

LABELS = {
    'cura recebida': 'healReceived', 'efetividade de cura': 'healPower', 'regen. natural de hp': 'hpRecovRate',
    'regeneracao natural de hp': 'hpRecovRate', 'regen. natural de sp': 'spRecovRate', 'regeneracao natural de sp': 'spRecovRate',
    'custo de sp': 'spCostPercent', 'crit': 'cri', 'dano critico': 'criDmg', 'dano fisico': 'atkPercent', 'dano magico': 'matkPercent',
}


def rules_of(text: str, elements=None):
    """(rules, reason) for one wiki line, with the extra shapes these three pages use."""
    text = re.sub(r'(\d)\s*%\s*~', r'\1~', text.replace(' ', ' ').strip().rstrip('.'))
    text = re.sub(r'\[(?:propriedade|elemento)\]', '[PROP.]', text, flags=re.I)
    text = re.sub(r'resist[eê]ncia [àa] ra[çc]a', 'Resistência a', text, flags=re.I)
    low = plain(text)
    ignore = re.match(r'^ignora (\d+)%?\s*~\s*(\d+)%? de (def|defm) (?:da \[raca\]|de monstros (normais|chefes))', low)
    if ignore:
        lo, hi, prefix = int(ignore[1]), int(ignore[2]), 'p_pene_' if ignore[3] == 'def' else 'm_pene_'
        if ignore[4]:
            return [{'key': prefix + 'class_' + ('normal' if ignore[4] == 'normais' else 'boss'), 'min': lo, 'max': hi}], None
        return [{'key': f'{prefix}race_{race}', 'min': lo, 'max': hi} for race in RACES], None
    match = re.match(r'^(.*?)\s*[+-]?\s*(\d[\d.]*)(?:\s*~\s*(\d[\d.]*))?\s*%?\.?$', low)
    if match:
        label, lo, hi = match[1], int(match[2].replace('.', '')), int((match[3] or match[2]).replace('.', ''))
        if label in LABELS:
            return [{'key': LABELS[label], 'min': lo, 'max': hi}], None
        if elements and label == 'resistencia a [prop.]':
            return [{'key': 'subele_' + e, 'min': lo, 'max': hi} for e in elements], None
        member = re.match(r'^resistencia a (\w+)$', label)
        if member and member[1] in ELEMENT_NAMES:
            return [{'key': 'subele_' + ELEMENT_NAMES[member[1]], 'min': lo, 'max': hi}], None
        if label == 'resistencia a todas as propriedades, exceto neutro':
            return [{'key': 'subele_' + e, 'min': lo, 'max': hi} for e in ELEMENT_NAMES.values() if e != 'neutral'], None
        if re.match(r'^resistencia (fisica|magica) a oponentes (?:de )?\[prop\.\]$', label):
            # The engine has subele_<element>_physical/_magical (PvP), but the picker offers no such option: not guessed.
            return [], 'o seletor não oferece resistência física/mágica por propriedade'
    return translate(text)


class Tables(HTMLParser):
    """Every table as a list of rows; a cell keeps its text, its item links and the text of each <li>.
    Tables nest (layout tables inside cells), so the open row and cell belong to the innermost table."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self.stack = [], []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        top = self.stack[-1] if self.stack else None
        if tag == 'table':
            self.stack.append({'rows': [], 'row': None, 'cell': None})
        elif tag == 'tr' and top:
            top['row'] = []
        elif tag in ('td', 'th') and top and top['row'] is not None:
            top['cell'] = {'tag': tag, 'text': [], 'links': [], 'lis': []}
        elif tag == 'li' and top and top['cell']:
            top['cell']['lis'].append([])
        elif tag == 'a':
            m = re.search(r'/item/(\d+)', a.get('href', ''))
            for table in self.stack:  # a link inside a nested table also belongs to the cell that holds it
                if m and table['cell']:
                    table['cell']['links'].append(int(m[1]))

    def handle_data(self, data):
        for table in self.stack:  # the text of a nested table also belongs to the cell that holds it
            cell = table['cell']
            if cell:
                cell['text'].append(data)
                if cell['lis']:
                    cell['lis'][-1].append(data)

    def handle_endtag(self, tag):
        top = self.stack[-1] if self.stack else None
        if not top:
            return
        if tag in ('td', 'th') and top['cell'] is not None and top['row'] is not None:
            cell = top['cell']
            cell['text'] = re.sub(r'\s+', ' ', ''.join(cell['text'])).strip()
            cell['lis'] = [re.sub(r'\s+', ' ', ''.join(li)).strip() for li in cell['lis']]
            top['row'].append(cell)
            top['cell'] = None
        elif tag == 'tr' and top['row'] is not None:
            top['rows'].append(top['row'])
            top['row'] = None
        elif tag == 'table':
            self.tables.append(self.stack.pop())


def read(name: str):
    parser = Tables()
    parser.feed(Path(PAGES.format(name)).read_text(encoding='utf8', errors='replace'))
    return parser.tables


def pool(combiner_id, name, columns, unmapped, elements=None):
    """One profile: `columns` is a list of positions, each a list of rule texts."""
    positions = []
    for texts in columns:
        merged = {}
        for text in texts:
            rules, reason = rules_of(text, elements)
            if reason:
                unmapped[f'{name}: {plain(text)} [{reason}]'] += 1
            for rule in rules:
                merged[rule['key']] = rule
        positions.append(list(merged.values()))
    return {'combiner': name, 'positions': positions}


def lago(unmapped):
    """Title row "<icon> Name (Armaduras|Capa|Calçado)", then the 1º/2º/3º columns of bullet lists."""
    result = {}
    for table in read('Lago_do_Abismo'):
        rows = table['rows']
        for at in range(len(rows) - 2):
            title, header, body = rows[at], rows[at + 1], rows[at + 2]
            if len(title) == 1 and title[0]['links'] and header[0]['text'].startswith('1') and len(body) == 3:
                name = re.sub(r'\s*\(.*$', '', title[0]['text']).strip()
                result[title[0]['links'][0]] = pool(title[0]['links'][0], name, [cell['lis'] for cell in body], unmapped)
    armour = [result[i] for i in (23981, 100142)]
    return {**{item: armour for item in range(15391, 15397)}, 20946: [result[100144]], 22208: [result[100145]]}


def tournament(unmapped):
    """Rows of one table: a combiner row (Encantador, its items, then the first rule/chance pairs), and rows that
    carry only the next rule/chance pairs. A row with a missing first pair (rowspan) starts at the second."""
    items = {}
    for table in read('Torneio_de_Magia'):
        group, targets, columns = None, [], [[], []]

        def close():
            if group and any(columns):
                items[group] = (targets, pool(0, group, columns, unmapped, TOURNAMENT_ELEMENTS))
        for row in table['rows']:
            links = [link for cell in row for link in cell['links']]
            if 23675 in links or 23679 in links:
                close()
                group = 'Encantador Mágico de Geffen' if 23675 in links else 'Encantador Místico de Geffen'
                targets, columns = [l for l in links if l not in (6541, 23675, 23679)], [[], []]
                row = row[2:]
            elif group and len(row) == 1:
                targets += [l for l in links if l not in (6541, 23675, 23679)]
                continue
            if not group:
                continue
            if len(row) >= 4:
                columns[0].append(row[0]['text'])
                columns[1].append(row[2]['text'])
            elif len(row) == 3 and not row[0]['text']:
                columns[1].append(row[1]['text'])
        close()
    return {item: [profile] for targets, profile in items.values() for item in targets}


def arena(unmapped):
    """Per equipment type, one table "Linha | Bônus Aleatórios": a row per position with a bullet list."""
    where = {'Armaduras': [450149, 450150], 'Capas': [480065, 480066, 480067, 480068],
             'Escudos': [460005, 460006], 'Acessórios': [490077, 490078]}
    result = {}
    for table in read('Arena_Noturna'):
        rows = table['rows']
        title = plain(rows[0][0]['text']) if rows and rows[0] else ''
        kind = next((k for k in where if plain(k) == title), None)
        if kind and len(rows) > 2 and rows[1][0]['text'] == 'Linha':
            profile = pool(0, f'Adorno ({kind})', [row[1]['lis'] for row in rows[2:] if len(row) == 2], unmapped)
            for item in where[kind]:
                result[item] = [profile]
    return result


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    unmapped = Counter()
    pages = {
        'Lago_do_Abismo': lago(unmapped), 'Torneio_de_Magia': tournament(unmapped), 'Arena_Noturna': arena(unmapped),
    }
    document = load(OUT)
    drop_owned(document, OWNED)
    for page, items in pages.items():
        source = f'https://browiki.org/wiki/{page} ({OWNED})'
        confidence = f'bROWiki ({page.replace("_", " ")}); faixas de referência, não medidas por nós'
        for item, profiles in items.items():
            for profile in profiles:
                put(document, [item], profile['combiner'], profile['positions'], source, confidence)
    dump(OUT, document)
    for page, items in pages.items():
        print(f'{page}: {len(items)} itens', sorted(items))
    for text, count in unmapped.most_common():
        print(f'  sem chave  {count:2d}  {text}')


if __name__ == '__main__':
    main()
