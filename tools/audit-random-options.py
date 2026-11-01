"""Reproduce item -> random-option references. Requires PyYAML, no network access.

Usage: python tools/audit-random-options.py --rathena .scratch/rathena
Upstream data describes rAthena, not confirmed LATAM availability.
"""
import argparse
import json
import re
import subprocess
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent


def audit(source):
    def body(name):
        return yaml.load((source / 'db/re' / name).read_text(encoding='utf-8'), Loader=yaml.CSafeLoader)['Body']

    revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    items = json.loads((ROOT / 'src/assets/demo/data/item.json').read_text(encoding='utf-8'))
    table = dict((name, int(count)) for name, count in re.findall(
        r'^\s*(\w+): (\d+),', (ROOT / 'src/app/constants/extra-option-table.ts').read_text(encoding='utf-8'), re.M))
    upstream = {}
    for name in ('item_db_equip.yml', 'item_db_usable.yml', 'item_db_etc.yml'):
        for row in body(name):
            upstream[row['AegisName']] = row['Id']
    groups = {row['Group']: row for row in body('item_randomopt_group.yml')}
    options = {row['Option']: row for row in body('item_randomopt_db.yml')}
    links = {}

    def link(target, group, file, origin, conditions):
        if target:
            links.setdefault(target, []).append(dict(group=group, file=file, origin=origin, conditions=conditions))

    for row in body('laphine_upgrade.yml'):
        if row.get('RandomOptionGroup'):
            for target in row.get('TargetItems', []):
                link(target['Item'], row['RandomOptionGroup'], 'laphine_upgrade.yml', row['Item'],
                     {k: v for k, v in row.items() if k not in ('Item', 'TargetItems', 'RandomOptionGroup')})
    for row in body('item_reform.yml'):
        for base in row.get('BaseItems', []):
            if base.get('RandomOptionGroup'):
                # Reform applies options to the RESULT, not necessarily the base item.
                link(base.get('ResultItem', base['BaseItem']), base['RandomOptionGroup'], 'item_reform.yml', row['Item'],
                     {k: v for k, v in base.items() if k != 'RandomOptionGroup'})
    for mob in body('mob_db.yml'):
        for field in ('Drops', 'MvpDrops'):
            for drop in mob.get(field, []):
                if drop.get('RandomOptionGroup'):
                    link(drop['Item'], drop['RandomOptionGroup'], 'mob_db.yml', mob['AegisName'], {'dropType': field})

    records = {}
    for item in items.values():
        name, item_id = item['aegisName'], item['id']
        kind = 'weapon-generic' if item['itemTypeId'] == 1 else 'shadow-generic' if item['itemTypeId'] == 10 else 'explicit-table'
        refs = links.get(name, [])
        if name not in table and kind == 'explicit-table' and not refs:
            continue
        same_id = upstream.get(name) == item_id
        references = []
        for ref in refs:
            group = groups.get(ref['group'])
            references.append({**ref, 'url': f'https://github.com/rathena/rathena/blob/{revision}/db/re/{ref["file"]}',
                               'groupDefined': group is not None,
                               'hasRollPool': bool(group and (group.get('Slots') or group.get('MaxRandom', 0))),
                               'identityMatched': same_id})
        records[str(item_id)] = dict(aegisName=name, name=item['name'], policy=kind,
            capacity=3 if kind == 'weapon-generic' else 2 if kind == 'shadow-generic' else table.get(name, 0),
            status='upstream-reference' if references and same_id else 'identity-conflict' if references else 'not-found',
            references=references)
    # Preserve unresolved table entries too: missing local items must not vanish from the audit.
    missing = {name: capacity for name, capacity in table.items() if not any(x['aegisName'] == name for x in items.values())}
    used = {ref['group'] for record in records.values() for ref in record['references']}
    used_groups = {name: groups[name] for name in sorted(used) if name in groups}
    used_options = {opt['Option'] for group in used_groups.values()
                    for slot in group.get('Slots', []) for opt in slot.get('Options', [])}
    used_options.update(opt['Option'] for group in used_groups.values() for opt in group.get('Random', []))
    # Store constants/IDs and bounds. Do not copy executable upstream scripts into the app.
    scalar = dict(bMaxHP='hp', bMaxSP='sp', bMaxHPrate='hpPercent', bMaxSPrate='spPercent',
                  bStr='str', bAgi='agi', bVit='vit', bInt='int', bDex='dex', bLuk='luk',
                  bAtk='atk', bBaseAtk='atk', bMatk='matk', bAtkRate='atkPercent', bMatkRate='matkPercent',
                  bDef='def', bMdef='mdef', bHit='hit', bFlee='flee', bFlee2='perfectDodge',
                  bCritical='cri', bAspd='aspd', bAspdRate='aspdPercent', bCritAtkRate='criDmg',
                  bLongAtkRate='range', bShortAtkRate='melee', bHealPower='healPower', bHealPower2='healReceived')
    def option_record(name):
        row = options[name]
        script = row.get('Script', '').strip()
        match = re.fullmatch(r'bonus (\w+),getrandomoptinfo\(ROA_VALUE\);', script)
        key = scalar.get(match[1]) if match else None
        if script == 'bonus bVariableCastrate,-(getrandomoptinfo(ROA_VALUE));':
            key = 'vct'
        if script == 'bonus bDelayrate,-(getrandomoptinfo(ROA_VALUE));':
            key = 'acd'
        return {'id': row['Id'], **({'calculatorKey': key} if key else {}),
                'mapping': 'exact-script' if key else 'not-mapped'}
    result = dict(revision=revision, source='https://github.com/rathena/rathena',
                  scope=['laphine_upgrade.yml', 'item_reform.yml', 'mob_db.yml'],
                  disclaimer='rAthena reference only; not proof of LATAM availability. NPC-only and regional pools may be missing.',
                  missingLocalItems=missing, items=records, groups=used_groups,
                  options={name: option_record(name) for name in sorted(used_options) if name in options})
    output = ROOT / 'data/random-options/rathena-audit.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    report = ['# Vínculos de bônus aleatórios por item', '',
              f'Fonte: rAthena `{revision}`. Gerado por `tools/audit-random-options.py`.', '',
              'Referência do emulador, sem confirmação de disponibilidade ou equivalência no LATAM.',
              'Inclui toda a ExtraOptionTable, todas as armas e sombrios com campos genéricos e outros itens com vínculo na fonte.',
              'Não encontrado significa ausência nas bases consultadas, não impossibilidade no jogo.',
              'Group_0 é um grupo vazio que remove opções; grupos vazios ou indefinidos não oferecem rolagens.', '',
              '| ID | Aegis | Campos na calc | Política | Grupos / combinadores |',
              '| --- | --- | --- | --- | --- |']
    for item_id, record in records.items():
        refs = '; '.join(f'[{ref["group"]}]({ref["url"]}) / {ref["origin"]}'
                         + (' (grupo indefinido)' if not ref['groupDefined'] else ' (sem rolagens)' if not ref['hasRollPool'] else '')
                         for ref in record['references']) or 'Não encontrado'
        report.append(f'| {item_id} | {record["aegisName"]} | {record["capacity"]} | {record["policy"]} | {refs} |')
    (ROOT / 'docs/random-options-items.generated.md').write_text('\n'.join(report) + '\n', encoding='utf-8')
    print(f'Wrote {output.relative_to(ROOT)}: {len(records)} items, {len(used_groups)} groups')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rathena', required=True, type=Path)
    audit(parser.parse_args().rathena.resolve())
