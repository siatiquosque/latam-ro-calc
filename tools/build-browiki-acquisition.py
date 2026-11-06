#!/usr/bin/env python3
"""Normalizes three bROWiki pages into an Acquisition Knowledge curation file (Phase 4.1).

    python tools/build-browiki-acquisition.py --src <dir with the saved pages> --output data/acquisition/curation/phase41-browiki.v1.json

The pages are read from disk (never fetched here), and each source record carries the sha256 of the saved HTML, the MediaWiki revision
id and the page's last-modified date, so the file is reproducible against the exact snapshot. Only facts the pages state are written:
what a page does not say (slot order, chance of success, current availability) is left null and listed under `unknowns`.
bROWiki documents the Brazilian server; the pages carry no LATAM period, so routes stay `known: false` (availability unconfirmed).

Expected files in --src (rendered pages, as saved by `curl https://browiki.org/wiki/<Page>`):
Equipamentos_Automatron.html, Equipamentos_Invernais.html, Cinzentos.html (page "Equipamentos_Cinzentos").
"""
import argparse, hashlib, json, re, sys
from fractions import Fraction
from bs4 import BeautifulSoup

RETRIEVED = '2026-11-05'
REVISION = 'latam-acquisition-phase41-2026-11-05'
LICENSE = 'Reuse license unconfirmed; normalized facts only'
PAGES = {  # key -> (file, url, locator)
    'automatron': ('Equipamentos_Automatron.html', 'https://browiki.org/wiki/Equipamentos_Automatron', 'Automódulos; Equipamentos Automatron; tabelas B-/M-/P-/F-/H-'),
    'invernais': ('Equipamentos_Invernais.html', 'https://browiki.org/wiki/Equipamentos_Invernais', 'Obtenção; Encantamentos de armaduras e acessórios; Custos das Armas Invernais; Dano, utilidade e atributos'),
    'cinzentos': ('Cinzentos.html', 'https://browiki.org/wiki/Equipamentos_Cinzentos', 'Equipamentos Cinzentos; Encantos possíveis por slot'),
}
VALE_VARMIDA, PETALA, AMETISTA = 1000103, 1000608, 1000405
GLOBO, GLOBO_BRILHANTE, GLOBO_RELUZENTE = 1000812, 1000813, 1000814
GLOBO_NAMES = {GLOBO: 'Globo de Flor Invernal', GLOBO_BRILHANTE: 'Globo de Flor Invernal Brilhante', GLOBO_RELUZENTE: 'Globo de Flor Invernal Reluzente'}
# Automatron pieces (client names `Auto_*`; ids checked against items-core): A/B variants per column of the module table.
AUTOMATRON_COLUMNS = [('Colete', [450127, 450128]), ('Motor', [480020, 480021]), ('Perna', [470022, 470023]),
                      ('Ac. D.', [490024, 490026]), ('Ac. E.', [490025, 490027]), ('Escudo', [460157, 460158])]
# Equipment other than weapons exposes enchant positions 1-3 (position 0 is the card slot); weapons expose 0-3.
GEAR_POSITIONS = [1, 2, 3]
ONE = {'numerator': 1, 'denominator': 1}


def sha(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()


def soup(path):
    with open(path, encoding='utf8') as f:
        return BeautifulSoup(f.read(), 'html.parser')


def item_ids(node):
    return [int(m) for m in re.findall(r'/item/(\d+)', str(node))]


def text(node):
    return re.sub(r'\s+', ' ', node.get_text(' ', strip=True)).strip()


def fraction(percent):
    f = Fraction(percent.replace('%', '').replace(',', '.').strip()) / 100
    return {'numerator': f.numerator, 'denominator': f.denominator}


def page_source(src, key):
    file, url, locator = PAGES[key]
    html = open(f'{src}/{file}', encoding='utf8').read()
    revision = re.search(r'wgRevisionId":(\d+)', html).group(1)
    modified = re.search(r'id="footer-info-lastmod"[^>]*>\s*([^<]+)', html).group(1).strip()
    return {'id': f'browiki-{key}-{revision}', 'url': url, 'version': f'oldid={revision}; {modified}', 'retrievedOn': RETRIEVED,
            'sha256': sha(f'{src}/{file}'), 'license': LICENSE, 'locator': locator, 'via': 'curl https://browiki.org/wiki/<page> (rendered HTML)'}


def requirement(kind, description, item_id=None, amount=None, **extra):
    return {'kind': kind, 'itemId': item_id, 'amount': amount, 'minRefine': extra.pop('minRefine', None), 'description': description, **extra}


def material(item_id, amount, description):
    return requirement('material', description, item_id, amount, consumed=True)


def route(rid, family, label, method, sources, target, requirements, *, steps=(), outputs=None, selection=None, success=None, outcomes=(),
          enchants='', zeny=None, cost_reason, unknowns, result_extra=None):
    body = {
        'id': rid, 'importKey': f'curated:{rid}', 'family': family, 'label': label, 'method': method, 'target': target,
        'server': 'LATAM', 'period': {'start': None, 'end': None, 'known': False}, 'review': 'reviewed', 'confidence': 'medium',
        'sources': sources, 'requirements': requirements, 'steps': list(steps), 'success': success, 'outcomes': list(outcomes),
        'result': {'refine': 'unknown', 'grade': 'unknown', 'cards': 'unknown', 'enchants': enchants or 'unknown', 'binding': 'unknown', **(result_extra or {})},
        'cost': {'zeny': zeny, 'marketZeny': None, 'difficulty': 'unknown', 'reason': cost_reason},
        'unknowns': unknowns, 'supersedes': None,
        'revisionReason': 'bROWiki (Brazil) documents the procedure; no LATAM confirmation of period, chance or current availability.',
    }
    if outputs is not None:
        body['outputs'] = outputs
        body['outputSelection'] = selection or 'unknown'
    return body


def item_target(item_ids):
    return {'itemIds': sorted(set(item_ids)), 'aspect': 'item', 'enchantIds': [], 'position': None, 'refine': None, 'grade': None}


def enchant_target(gear, enchant_id, position):
    return {'itemIds': sorted(set(gear)), 'aspect': 'enchant', 'enchantIds': [enchant_id], 'position': position, 'refine': None, 'grade': None}


def step(materials, zeny=None, success=None, destroys=None):
    return {'fromLevel': 0, 'toLevel': 1, 'materials': [{'itemId': i, 'amount': a} for i, a in materials], 'zeny': zeny, 'success': success,
            'failure': {'destroysItem': destroys, 'levelDelta': None, 'floor': None}}


def outputs_of(ids):
    return [{'itemId': i, 'quantity': {'min': 1, 'max': 1}, 'chance': None} for i in ids]


UNCONFIRMED = 'Período e disponibilidade atual no LATAM não confirmados.'


# ---------------------------------------------------------------------------------------------------------------- Automatron
def automatron(src, source):
    page = soup(f'{src}/{PAGES["automatron"][0]}')
    routes = []
    # Equipment: Ilusión (+9 for the armor pieces) + Vale Varmida, with Epsilon.
    for tr in page.find_all('tr'):
        tds = tr.find_all('td', recursive=False)
        if len(tds) != 3 or not text(tds[0]).endswith(('Automatron A', 'Automatron B')) or not text(tds[2]).replace('.', '').isdigit():
            continue
        out, base = item_ids(tds[0])[0], item_ids(tds[1])[0]
        vales = int(text(tds[2]).replace('.', ''))
        refine = re.match(r'\+(\d+)', text(tds[1]))
        routes.append(route(f'automatron-gear-{out}-v1', 'automatron', f'{text(tds[0])}: {text(tds[1])} + {vales} Vale Varmida', 'exchange', [source], item_target([out]), [
            requirement('npc', 'Epsilon, ba_in01 87,383 (Mansão de Varmunt)'),
            requirement('equipment', text(tds[1]), base, 1, minRefine=int(refine.group(1)) if refine else None, consumed=True),
            material(VALE_VARMIDA, vales, 'Vale Varmida'),
        ], outputs=outputs_of([out]), selection='all', cost_reason='Sem estimativa econômica; a página não lista zeny.',
            unknowns=['Cartas, módulos e refino do equipamento Ilusión são perdidos na troca (página).', UNCONFIRMED],
            result_extra={'refine': 'perdido', 'cards': 'perdidas', 'enchants': 'perdidos'}))
    # Modules: random exchange, 63 Vale Varmida, Upsilon. The chance of each module lives in the Caixa de Automódulos item page.
    modules = {}
    for tr in page.find_all('tr'):
        tds = tr.find_all('td', recursive=False)
        if len(tds) >= 9 and text(tds[0]).startswith('Automódulo') and item_ids(tds[1]):
            mod = int(re.match(r'(\d+)', tds[0].find('img')['alt']).group(1))
            modules[mod] = {'name': text(tds[0]), 'enchantId': item_ids(tds[1])[0], 'enchant': text(tds[1]), 'effect': text(tds[2]), 'limits': [text(t) for t in tds[3:9]]}
    # H- (skill) modules: same exchange, but the table has only the Colete limit and a class cell shared through `rowspan`.
    in_h, classes, left = False, '', 0
    for tr in page.find_all('tr'):
        head = tr.find('th', colspan='12')
        if head:
            in_h = text(head).startswith('H-')
            continue
        tds = tr.find_all('td', recursive=False)
        if not in_h or not tds or not text(tds[0]).startswith('Automódulo') or not item_ids(tds[1]):
            continue
        if len(tds) >= 5:
            classes, left = text(tds[4]), int(tds[4].get('rowspan', 1))
        if left <= 0:
            raise SystemExit(f'H- module without class cell: {text(tds[0])}')
        left -= 1
        mod = int(re.match(r'(\d+)', tds[0].find('img')['alt']).group(1))
        modules[mod] = {'name': text(tds[0]), 'enchantId': item_ids(tds[1])[0], 'enchant': text(tds[1]), 'effect': 'Habilidades: ' + text(tds[2]),
                        'limits': [text(tds[3]), '-', '-', '-', '-', '-'], 'classes': classes}
    routes.append(route('automatron-module-exchange-v1', 'automatron', 'Automódulo aleatório por 63 Vale Varmida', 'exchange', [source], item_target(list(modules)),
                        [requirement('npc', 'Upsilon, ba_in01 87,380'), material(VALE_VARMIDA, 63, 'Vale Varmida')],
                        outputs=outputs_of(sorted(modules)), selection='one', cost_reason='Troca por 63 Vale Varmida; sem estimativa de mercado.',
                        unknowns=['A chance de cada Automódulo fica na Caixa de Automódulos (página do item), não neste texto; não assumir pesos iguais.', UNCONFIRMED]))
    # Enchants applied by Liza: the module is consumed, no failure and no loss of the equipment.
    for mod, m in sorted(modules.items()):
        gear, notes = [], []
        for (col, ids), limit in zip(AUTOMATRON_COLUMNS, m['limits']):
            if limit != '-':
                gear += ids
                notes.append(f'{col} {limit}')
        if not gear:
            continue
        fantastic = m['enchant'].startswith('F-')
        for pos in GEAR_POSITIONS:
            routes.append(route(f'automatron-enchant-{m["enchantId"]}-position-{pos}-v1', 'automatron', f'{m["enchant"]} (posição {pos}) com {m["name"]}', 'enchant', [source],
                                enchant_target(gear, m['enchantId'], pos), [
                requirement('npc', 'Liza, ba_in01 87,370'),
                requirement('equipment', 'Equipamento Automatron compatível, equipado', None, 1, anyItemIds=sorted(set(gear))),
                material(mod, 1, m['name']),
                requirement('procedure', 'Limite por equipamento: ' + '; '.join(notes) + '. Máximo de 3 encantamentos por peça; encantos não são resetáveis.'
                            + (' Apenas 2 encantos Fantásticos, sem repetir.' if fantastic else '')
                + (f' A página associa o módulo à(s) classe(s): {m["classes"]}; não informa se a aplicação é bloqueada para outras classes.' if 'classes' in m else '')),
            ], steps=[step([(mod, 1)], success=ONE, destroys=False)], success=ONE,
                enchants=f'{m["enchant"]}: {m["effect"]} (bônus a +11)', cost_reason='Sem zeny na página; o custo é o Automódulo (63 Vale Varmida, aleatório).',
                unknowns=['O 100% vale só para a aplicação: o Automódulo é obtido por sorteio (automatron-module-exchange-v1).', 'A página não informa a posição em que o NPC grava o encanto; as posições 1-3 foram registradas como rotas separadas.',
                          UNCONFIRMED + ' O 100% de sucesso vem da bROWiki, não de teste no LATAM.']))
    return routes, modules


# ---------------------------------------------------------------------------------------------------------------- Invernais
def invernais(src, source):
    page = soup(f'{src}/{PAGES["invernais"][0]}')
    routes, tables = [], page.find_all('table')
    names = {}
    for tr in tables[1].find_all('tr'):
        tds = tr.find_all('td', recursive=False)
        if tds and item_ids(tds[0]) and 'Pétala' not in text(tds[0]):
            names[re.sub(r'\s*\[\d\]$', '', re.sub(r'^\d+\s*', '', text(tds[0])))] = item_ids(tds[0])[0]
    routes.append(route('invernal-gear-exchange-v1', 'invernal-armor', 'Armaduras e acessórios Invernais por 100 Pétalas de Flor Invernal', 'exchange', [source],
                        item_target(list(names.values())), [requirement('npc', 'Maram, icas_in 180,61 (Castelo de Gelo)'), material(PETALA, 100, 'Pétala de Flor Invernal')],
                        outputs=outputs_of(names.values()), selection='unknown', cost_reason='100 Pétalas por equipamento; sem estimativa de mercado.', unknowns=[UNCONFIRMED]))
    # Plain (non-Vis) Invernal weapons: 150,000 zeny with Poruru. Vis weapons drop in the Abandoned Pit / Serpent God (monsters not named).
    weapons = []
    for tr in tables[2].find_all('tr')[1:]:
        tds = tr.find_all('td', recursive=False)
        if len(tds) == 2 and item_ids(tds[0]):
            weapons.append(item_ids(tds[0])[0])
    routes.append(route('invernal-weapon-purchase-v1', 'invernal-weapon', 'Armas Invernais por 150.000 zeny', 'exchange', [source], item_target(weapons),
                        [requirement('npc', 'Poruru, icas_in 188,60 (Castelo de Gelo); armas marcadas com * ficam em outra opção de diálogo'), requirement('procedure', 'Nível de uso 210')],
                        steps=[step([], zeny=150000)], outputs=outputs_of(weapons), selection='unknown', zeny=150000,
                        cost_reason='150.000 zeny por arma, preço do NPC.', unknowns=[UNCONFIRMED]))
    # Flor pieces: Vellgunde, 35 petals for one random piece.
    flor = []
    for table in tables:
        m = re.match(r'Slot \{(\d)\}', text(table.find('tr')))
        if not m:
            continue
        for tr in table.find_all('tr')[1:]:
            tds = tr.find_all('td', recursive=False)
            if len(tds) == 8 and item_ids(tds[0]):
                flor.append({'slot': int(m.group(1)), 'piece': item_ids(tds[0])[0], 'enchant': item_ids(tds[1])[0], 'name': text(tds[1]), 'effect': text(tds[2]),
                             'flags': [text(t).startswith('✔') for t in tds[3:8]]})
    columns = [[names[n] for n in cols] for cols in (
        ['Armadura Invernal', 'Veste Invernal'], ['Manto Invernal', 'Sobrepeliz Invernal'], ['Bota Invernal', 'Sapato Invernal'],
        ['Pingente Invernal', 'Colar Invernal'], ['Anel Invernal', 'Brinco Invernal'])]
    routes.append(route('flor-invernal-piece-exchange-v1', 'invernal-armor', 'Peça de Flor Invernal aleatória por 35 Pétalas', 'exchange', [source],
                        item_target([f['piece'] for f in flor]), [requirement('npc', 'Vellgunde, icas_in 185,63 (Castelo de Gelo)'), material(PETALA, 35, 'Pétala de Flor Invernal')],
                        outputs=outputs_of([f['piece'] for f in flor]), selection='one', cost_reason='35 Pétalas por troca; sem estimativa de mercado.',
                        unknowns=['A página não dá a chance de cada peça; não assumir pesos iguais.', UNCONFIRMED]))
    for f in flor:
        gear = [i for flag, col in zip(f['flags'], columns) if flag for i in col]
        if not gear:
            continue
        routes.append(route(f'flor-invernal-enchant-{f["enchant"]}-v1', 'invernal-armor', f'{f["name"]} no slot {{{f["slot"]}}}', 'enchant', [source], enchant_target(gear, f['enchant'], f['slot'] - 1), [
            requirement('npc', 'Serviço de encantamento (Castelo de Gelo); a página não nomeia o NPC'),
            requirement('equipment', 'Armadura, capa, calçado ou acessório Invernal compatível, sem refino ou grau mínimo', None, 1, anyItemIds=sorted(set(gear))),
            material(f['piece'], 1, f'Peça de {f["name"]}'),
        ], steps=[step([(f['piece'], 1)], zeny=0)], enchants=f'{f["name"]}: {f["effect"]} (a +11)', zeny=0,
            cost_reason='Sem zeny; o custo é uma Peça de Flor Invernal (35 Pétalas, aleatória).',
            unknowns=['A página não informa a chance de sucesso do encantamento nem o NPC.', 'Encantos não podem ser resetados (página).', UNCONFIRMED]))
    # Weapon crystals (plain Invernal weapons only): cost per slot category; the page itself flags the Globo costs as unconfirmed.
    category_cost = {'Dano': [(GLOBO_BRILHANTE, 20), (GLOBO_RELUZENTE, 10)], 'Utilidade': [(GLOBO, 25), (GLOBO_BRILHANTE, 35)], 'Atributos': [(GLOBO, 50)]}
    table = next(t for t in tables if text(t.find('tr')) == 'Dano')
    category = None
    for tr in table.find_all('tr'):
        label = text(tr)
        if label in category_cost:
            category = label
            continue
        tds = tr.find_all('td', recursive=False)
        if len(tds) != 6 or not item_ids(tds[0]) or category is None:
            continue
        crystal, name = item_ids(tds[0])[0], text(tds[0])
        for slot, flag in enumerate(text(t).startswith('✔') for t in tds[2:6]):
            if not flag:
                continue
            cost = category_cost[category]
            routes.append(route(f'cristal-invernal-{crystal}-position-{slot}-v1', 'invernal-weapon', f'{name} no slot {{{slot + 1}}}', 'enchant', [source], enchant_target(weapons, crystal, slot), [
                requirement('npc', 'Poruru, icas_in 188,60 (Castelo de Gelo)'),
                requirement('equipment', 'Arma Invernal (não Vis), sem espaço para carta', None, 1, anyItemIds=sorted(set(weapons))),
                *[material(i, a, GLOBO_NAMES[i]) for i, a in cost],
            ], steps=[step(cost, zeny=0)], enchants=f'{name}: {text(tds[1])}', zeny=0, cost_reason=f'Sem zeny; materiais da categoria {category}.',
                unknowns=['A página afirma que os custos com Globos de Flor Invernal não estão confirmados.', 'A página não informa a chance de sucesso.', UNCONFIRMED]))
    return routes


# ---------------------------------------------------------------------------------------------------------------- Cinzentos
CINZENTOS_SECTIONS = [  # heading, slug, gear ids (Traje/Veste; Capa/Sobrepeliz; Botas/Sapatos; Pingente, Anel, Brincos, Colar)
    ('Armaduras', 'armor', [450177, 450178]), ('Capas', 'garment', [480091, 480090]), ('Calçados', 'shoes', [470087, 470088]), ('Acessórios', 'accessory', [490106, 490107, 490108, 490109])]
SLOT_COST = {3: (100000, 15), 2: (150000, 25), 1: (200000, 50)}  # page slot -> (zeny, Fragmentos de Ametista); 3 slots map to enchant positions 1-3


def cinzentos(src, source):
    page = soup(f'{src}/{PAGES["cinzentos"][0]}')
    routes, duplicates = [], []
    gear_all = [i for _, _, ids in CINZENTOS_SECTIONS for i in ids]
    routes.append(route('lobo-cinzento-gear-purchase-v1', 'lobo-cinzento', 'Equipamentos do Lobo Cinzento por 350 Fragmentos de Ametista', 'exchange', [source], item_target(gear_all),
                        [requirement('npc', 'Emet, wolfvill 164,137 (Aldeia do Lobo Cinzento)'), material(AMETISTA, 350, 'Fragmento de Ametista'),
                         requirement('procedure', 'Nível de base 170; Caminho da Oração completa')],
                        outputs=outputs_of(gear_all), selection='unknown', cost_reason='350 Fragmentos de Ametista por equipamento.', unknowns=[UNCONFIRMED]))
    for heading, slug, gear in CINZENTOS_SECTIONS:
        table = next(h for h in page.find_all('h2') if text(h).startswith(heading)).find_next('table')
        pools = {1: {}, 2: {}, 3: {}}
        for tr in table.find_all('tr'):
            tds = tr.find_all('td', recursive=False)
            if len(tds) != 6:
                continue
            for slot in (1, 2, 3):
                name_td, pct_td = tds[(slot - 1) * 2], tds[(slot - 1) * 2 + 1]
                ids = item_ids(name_td) or [int(m) for m in re.findall(r'(\d+)\.png', str(name_td))]
                if not ids or not re.match(r'[\d,.]+%', text(pct_td)):
                    continue
                if ids[0] in pools[slot]:
                    duplicates.append(f'{heading} slot {slot}: {text(name_td)} repetido ({text(pct_td)})')
                    continue
                pools[slot][ids[0]] = (text(name_td), fraction(text(pct_td)))
        for slot, pool in pools.items():
            zeny, shards = SLOT_COST[slot]
            for orb, (name, chance) in pool.items():
                routes.append(route(f'lobo-cinzento-{slug}-slot{slot}-{orb}-v1', 'lobo-cinzento', f'{name} no slot {slot} ({heading})', 'enchant', [source], enchant_target(gear, orb, slot), [
                    requirement('npc', 'Emet, wolfvill 164,137 (Aldeia do Lobo Cinzento)'),
                    requirement('equipment', 'Equipamento do Lobo Cinzento com refino +7 ou mais', None, 1, minRefine=7, anyItemIds=gear),
                    material(AMETISTA, shards, 'Fragmento de Ametista'),
                ], steps=[step([(AMETISTA, shards)], zeny=zeny, success=chance)], success=chance, outputs=[{'itemId': orb, 'quantity': {'min': 1, 'max': 1}, 'chance': chance}], selection='one',
                    enchants=name, zeny=zeny, cost_reason=f'{zeny:,} zeny e {shards} Fragmentos de Ametista por sorteio no slot {slot}.'.replace(',', '.'),
                    unknowns=['A aplicação tem 100% de sucesso, mas o orbe é sorteado: `success` é a chance de este orbe sair no sorteio do slot (a página não diz se o resultado é independente entre os slots).',
                              'A correspondência entre o slot da página e a posição do encanto no LaRo (3 slots, posições 1-3) é pela contagem, não declarada pela página.', UNCONFIRMED]))
    return routes, duplicates


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--output', required=True)
    args = ap.parse_args()
    sources = {key: page_source(args.src, key) for key in PAGES}
    auto, modules = automatron(args.src, sources['automatron']['id'])
    inv = invernais(args.src, sources['invernais']['id'])
    lobo, duplicates = cinzentos(args.src, sources['cinzentos']['id'])
    kb = {'schemaVersion': 1, 'revision': REVISION, 'sources': list(sources.values()), 'routes': auto + inv + lobo, 'effects': [], 'enchantGroups': []}
    json.dump(kb, open(args.output, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print(json.dumps({'routes': len(kb['routes']), 'automatron': len(auto), 'invernais': len(inv), 'cinzentos': len(lobo), 'modules': len(modules), 'cinzentosDuplicateRows': duplicates}, ensure_ascii=False))


if __name__ == '__main__':
    sys.exit(main())
