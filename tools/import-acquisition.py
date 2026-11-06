"""Small, offline rAthena extractor. Python 3 + PyYAML >=6; never executes NPC scripts.

Only selected reform entries and deterministic enchant Upgrades/PerfectEnchants.
Output is a NEW unreviewed generic candidate; no merge or regional-file writes.
"""
import argparse
from datetime import date
import hashlib
import json
from pathlib import Path
import re

import yaml


def extract(text, kind, selected, items, revision, retrieved_on, enchant_filter=None):
    if not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise ValueError('revision must be a full rAthena commit SHA')
    if date.fromisoformat(retrieved_on).isoformat() != retrieved_on:
        raise ValueError('retrieved-on must be YYYY-MM-DD')
    db = yaml.safe_load(text)
    if set(db) != {'Header', 'Body'}:
        raise ValueError('Unsupported root fields/import overlays')
    expected = {'reform': 'ITEM_REFORM_DB', 'enchant': 'ITEM_ENCHANT_DB'}[kind]
    if db['Header'] != {'Type': expected, 'Version': 1}:
        raise ValueError('Unsupported database header/version')
    names = {}
    for key, item in items.items():
        if item.get('aegisName'):
            names.setdefault(item['aegisName'], set()).add(item.get('id', int(key)))

    def item_id(name):
        ids = names.get(name, set())
        if len(ids) != 1:
            raise ValueError(f'Unresolved or ambiguous Aegis identity: {name}')
        return next(iter(ids))

    def fields(value, allowed):
        extra = set(value) - set(allowed.split())
        if extra:
            raise ValueError(f'Unsupported selected fields: {sorted(extra)}')

    def integer(value):
        if type(value) is not int or value < 0:
            raise ValueError(f'Invalid nonnegative integer: {value}')
        return value

    def material(m):
        fields(m, 'Material Amount')
        return dict(kind='material', itemId=item_id(m['Material']), amount=integer(m.get('Amount', 1)), minRefine=None, description=m['Material'])

    path = f'db/re/item_{kind}.yml'
    selection_id = hashlib.sha256('|'.join(sorted(selected)).encode()).hexdigest()[:8]
    source_id = f'rathena-{kind}-{revision[:12]}-{selection_id}'
    source = dict(id=source_id, url=f'https://github.com/rathena/rathena/blob/{revision}/{path}',
                  version=f'{revision}; {expected} v1', retrievedOn=retrieved_on,
                  sha256=hashlib.sha256(text.encode()).hexdigest(), license='GPL-3.0-or-later; rAthena Development Team',
                  locator='selected: ' + ', '.join(selected), via=None)
    routes = []
    found = set()

    def add(key, targets, requirements, result, enchants=None, position=None, min_refine=0):
        routes.append(dict(
            id=f'{source_id}-{key}', family='rathena-experimental', label=key,
            target=dict(itemIds=targets, aspect='enchant' if enchants else 'item', enchantIds=enchants or [], position=position, refine=None, grade=None),
            server='generic', period=dict(start=None, end=None, known=False), review='unreviewed', confidence='low', sources=[source_id],
            requirements=requirements + [dict(kind='procedure', itemId=None, amount=None, minRefine=min_refine,
                                               description='rAthena only; NPC and LATAM implementation unverified')],
            steps=[], success=dict(numerator=1, denominator=1), outcomes=[], result=result,
            cost=dict(zeny=None, marketZeny=None, difficulty='unknown', reason='Generic reference, no LATAM economic evidence'),
            unknowns=['LATAM availability and NPC implementation unverified'], supersedes=None,
            revisionReason='Experimental extraction; cannot supersede regional reviewed rules'))

    for row in db['Body']:
        selector = str(row['Item'] if kind == 'reform' else row['Id'])
        if selector not in selected:
            continue
        found.add(selector)
        if kind == 'reform':
            fields(row, 'Item BaseItems')
            for base in row['BaseItems']:
                fields(base, 'BaseItem MinimumRefine MaximumRefine RequiredRandomOptions CardsAllowed Materials ResultItem ChangeRefine RandomOptionGroup ClearSlots RemoveEnchantgrade')
                requirements = [dict(kind='procedure', itemId=item_id(row['Item']), amount=None, minRefine=None, description='Reform UI trigger; consumption requires NPC/runtime review'),
                    dict(kind='equipment', itemId=item_id(base['BaseItem']), amount=1, minRefine=integer(base.get('MinimumRefine', 0)), description=json.dumps({k: base.get(k, v) for k, v in dict(MaximumRefine=20, RequiredRandomOptions=0, CardsAllowed=True).items()}))]
                requirements += [material(m) for m in base.get('Materials', [])]
                result = dict(refine=f"input + ({base.get('ChangeRefine', 0)}) (runtime cap requires review)",
                    grade='removed' if base.get('RemoveEnchantgrade', False) else 'preserved', cards='cleared' if base.get('ClearSlots', False) else 'preserved',
                    enchants='cleared' if base.get('ClearSlots', False) else 'preserved', binding='unknown')
                if 'RandomOptionGroup' in base:
                    requirements.append(dict(kind='procedure', itemId=None, amount=None, minRefine=None, description='RandomOptionGroup: ' + base['RandomOptionGroup']))
                add(selector + '-' + base['BaseItem'], [item_id(base['ResultItem'])], requirements, result)
        else:
            fields(row, 'Id TargetItems MinimumRefine MinimumEnchantgrade AllowRandomOptions Reset Order Slots')
            targets = [item_id(name) for name, enabled in row['TargetItems'].items() if enabled]
            for slot in row.get('Slots', []):
                fields(slot, 'Slot Price Materials Chance EnchantgradeBonus Enchants PerfectEnchants Upgrades')
                # Normal random draws, reset and grade bonuses are intentionally NOT interpreted.
                for mode, output_key in [('PerfectEnchants', 'Item'), ('Upgrades', 'Upgrade')]:
                    for option in slot.get(mode, []):
                        if enchant_filter and option[output_key] not in enchant_filter:
                            continue
                        fields(option, 'Item Enchant Upgrade Price Materials')
                        requirements = [material(m) for m in option.get('Materials', [])]
                        requirements.append(dict(kind='procedure', itemId=None, amount=None, minRefine=None,
                            description=json.dumps(dict(order=row.get('Order', []), minimumGrade=row.get('MinimumEnchantgrade', 0),
                                allowRandomOptions=row.get('AllowRandomOptions', True), zeny=integer(option.get('Price', 0))))))
                        if mode == 'Upgrades':
                            requirements.append(dict(kind='procedure', itemId=item_id(option['Enchant']), amount=1, minRefine=None, description='Existing enchant in the same slot'))
                        key = f"{selector}-{slot['Slot']}-{mode}-{option[output_key]}"
                        add(key, targets, requirements, dict(refine='preserved', grade='preserved', cards='preserved', enchants='selected slot replaced', binding='unknown'),
                            [item_id(option[output_key])], integer(slot['Slot']), integer(row.get('MinimumRefine', 0)))
                        routes[-1]['cost']['zeny'] = integer(option.get('Price', 0))
    if found != set(selected):
        raise ValueError(f'Selection not found: {sorted(set(selected) - found)}')
    if not routes:
        raise ValueError('Selection has no supported operations (normal draws/reset are out of scope)')
    return dict(schemaVersion=1, revision=f'experimental-{revision}', sources=[source], enchantGroups=[], routes=routes, effects=[])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--kind', choices=['reform', 'enchant'], required=True)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--items', type=Path, default=Path('src/assets/demo/data/item.json'))
    parser.add_argument('--client', type=Path, default=Path('src/assets/demo/data/latam-items.json'))
    parser.add_argument('--select', nargs='+', required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--enchant', nargs='+', help='Restrict deterministic enchant outputs to these Aegis names')
    parser.add_argument('--retrieved-on', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = extract(args.input.read_bytes().decode('utf-8'), args.kind, args.select,
                     {**json.loads(args.client.read_text(encoding='utf-8')), **json.loads(args.items.read_text(encoding='utf-8'))}, args.revision, args.retrieved_on, args.enchant)
    for name, path in [('calc-identities', args.items), ('client-identities', args.client)]:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        source_id = f'{name}-{digest[:12]}'
        result['sources'].append(dict(id=source_id, url='local:' + path.as_posix(), version='local content snapshot ' + digest,
            retrievedOn=args.retrieved_on, sha256=digest, license='Local calculator MIT / client data Gravity; see docs/acquisition/acquisition-knowledge.md',
            locator='Aegis to numeric item identity resolution', via=None))
        for route in result['routes']:
            route['sources'].append(source_id)
    # Exclusive creation: cannot overwrite even an earlier extraction, let alone a confirmed rule.
    with args.output.open('x', encoding='utf-8', newline='\n') as file:
        json.dump(result, file, ensure_ascii=False, indent=2)
        file.write('\n')
    print(f"{len(result['routes'])} unreviewed generic candidates -> {args.output}")


if __name__ == '__main__':
    main()
