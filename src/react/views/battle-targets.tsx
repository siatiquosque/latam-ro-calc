import { useMemo, useState } from 'react';
import { elementPtBr, racePtBr, sizePtBr } from '../../app/constants/monster-i18n';
import { formatNumber } from '../../app/utils/format-number';
import { Icon } from '../ui/primitives';
import { Select } from '../ui/select';
import { MAX_TARGETS, critRateOf, describeTarget, type ExtraTargetRow } from '../state/extra-targets';
import { useText } from '../state/use-text';
import './battle-targets.css';

type SortKey = 'dps' | 'perCycle' | 'ttk' | 'name' | 'hp' | 'hit' | 'crit';
interface Row extends ExtraTargetRow { main: boolean; }

/** Ranking key for "Morre em": a target nothing can kill sorts last. */
const ttkOf = (row: Row) => row.ttkSeconds ?? Number.POSITIVE_INFINITY;

/**
 * The one target picker: a big grouped, searchable list (a map code filters to its mobs).
 * Off, a click on a row picks just that mob and closes. "V�rios" (inside the list, beside
 * Clear) turns on ticking: the list stays open, with the count and the ticked mobs on top.
 * The card shows the first one until another is chosen in the table. Choosing a map adds
 * nothing by itself.
 */
export function BattleTargetPicker({ vm }: { vm: any }) {
  const t = useText();
  const ids: number[] = vm.targetIds;
  // Already comparing when the page opens: the picker opens in the mode that shows it.
  const [multi, setMulti] = useState(ids.length > 1);
  // Just switched on: nothing shows ticked, so the first pick is the user's own and replaces the card's mob.
  const [fresh, setFresh] = useState(false);
  const nameOf = (id: number) => vm.monsterDataMap[id]?.name ?? id;
  const group = (entry: any) => <div className="flex align-items-center font-bold dropdown_monster_group_label"><span>{entry.label}</span></div>;
  const toggleMulti = () => {
    if (multi) vm.action(() => vm.setTargets([vm.selectedMonster]));
    setFresh(!multi);
    setMulti(on => !on);
  };
  const header = <div className="bt-picked">
    <div className="bt-picked-bar">
      <button type="button" className={`bt-multi ${multi ? 'bt-multi--on' : ''}`} aria-pressed={multi} title={t('targets.multiHint')}
        onClick={toggleMulti}><Icon name={multi ? 'check' : 'list'} />{t('targets.multi')}</button>
      {multi && !fresh && <span className="bt-count">{t('targets.count', { n: ids.length, max: MAX_TARGETS })}</span>}
      {multi && !fresh && ids.length > 1 && <button type="button" className="ui-link bt-clear" onClick={() => vm.action(() => vm.clearTargets())}>{t('targets.clear')}</button>}
    </div>
    {multi && !fresh && ids.length > 1 && <ul className="bt-chips">{ids.map(id => <li key={id} className={`bt-chip ${id === vm.selectedMonster ? 'bt-chip--card' : ''}`}>
      <span className="bt-chip-name">{nameOf(id)}</span>
      <button type="button" className="ui-link" aria-label={t('targets.remove', { name: nameOf(id) })}
        onClick={() => vm.action(() => vm.setTargets(ids.filter(value => value !== id)))}><Icon name="times" /></button>
    </li>)}</ul>}
  </div>;
  // One list for both modes, so it looks the same; single mode keeps the card's mob and closes on a pick.
  const onChange = (next: number[]) => {
    setFresh(false);
    vm.action(() => vm.setTargets(multi ? next : [next.find(id => id !== ids[0]) ?? ids[0]]));
  };
  return <Select kind="multiselect" className="bt-add" value={multi && fresh ? [] : ids} options={vm.groupMonsterList} optionValue="value" optionLabel="label"
    group filter filterBy="label,searchVal" resetFilterOnHide inputId="monsterOpponentHud" scrollHeight="400px" renderGroup={group}
    filterPlaceholder={t('calc.monsterFilter')} showToggleAll={false} closeOnSelect={!multi} checks={multi} panelClassName="bt-panel"
    fixedLabel={`${vm.selectedMonsterName ?? ''}${ids.length > 1 ? ` +${ids.length - 1}` : ''}`}
    ariaLabel={`${t('targets.title')} (${ids.length}/${MAX_TARGETS})`} panelHeader={header} onChange={onChange} />;
}

/**
 * The build against the main target plus the extras, one row each, with what the battle
 * card says about the monster. The main target stays the one the card details; a row's
 * name promotes it.
 */
export function BattleTargetsTable({ vm }: { vm: any }) {
  const t = useText();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const extras: ExtraTargetRow[] = vm.extraTargetRows;
  const view = vm.rotationView;
  const cycle = view && !view.timingUnknown ? view.cycle : null;
  const isSingle = (vm.model?.rotation?.length ?? 0) === 1;

  const rows = useMemo(() => {
    const body: Row[] = extras.map(row => ({ ...row, main: false }));
    if (sort) {
      const value = (row: Row) => sort.key === 'name' ? row.name : sort.key === 'ttk' ? ttkOf(row)
        : sort.key === 'hp' ? row.hp ?? 0 : sort.key === 'hit' ? row.hitFor100 ?? 0 : sort.key === 'crit' ? row.critRate ?? -1 : row[sort.key];
      body.sort((a, b) => {
        const [x, y] = [value(a), value(b)];
        return (typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number)) * sort.dir;
      });
    }
    const main: Row[] = cycle ? [{
      id: vm.selectedMonster, name: vm.selectedMonsterName, ...describeTarget(vm.totalSummary?.monster),
      dps: cycle.sustainedDps, perCycle: cycle.damagePerCycle, critRate: critRateOf(view),
      ttkText: view.ttk?.text ?? null, ttkSeconds: view.ttk?.seconds ?? null,
      cyclesToKill: view.ttk ? view.cyclesToKill : null, main: true,
    }] : [];
    return [...main, ...body];
  }, [extras, sort, cycle, view, vm.selectedMonster, vm.selectedMonsterName, vm.totalSummary]);

  if (!extras.length) return null;

  // Best and worst only mean something with two or more figures to rank.
  const ranked = rows.filter(row => row.dps > 0);
  const best = ranked.length > 1 ? Math.max(...ranked.map(row => row.dps)) : null;
  const worst = ranked.length > 1 ? Math.min(...ranked.map(row => row.dps)) : null;

  const header = (key: SortKey | null, label: string, numeric = false) => {
    const active = key != null && sort?.key === key;
    return <th scope="col" className={numeric ? 'bt-num' : ''} aria-sort={active ? (sort!.dir === 1 ? 'ascending' : 'descending') : undefined}>
      {key ? <button type="button" className="bt-sort" onClick={() => setSort(active && sort!.dir === -1 ? null : { key, dir: active ? -1 : key === 'name' ? 1 : -1 })}>
        {label}{active && <Icon name={sort!.dir === 1 ? 'chevron-up' : 'chevron-down'} />}</button> : label}</th>;
  };
  const number = (value: number | null) => value == null ? '—' : formatNumber(Math.round(value));

  return <section className="bt" aria-label={t('targets.title')}>
    <div className="bt-scroll"><table className="bt-table">
      <thead><tr>{header('name', t('targets.target'))}{header('hp', 'HP', true)}{header(null, t('targets.element'))}
        {header(null, t('targets.size'))}{header(null, t('targets.race'))}{header('hit', t('hud.hitFor100'), true)}{header('crit', t('pop.criRate'), true)}
        {header('perCycle', t(isSingle ? 'hud.perUse' : 'hud.perCycle'), true)}{header('dps', 'DPS', true)}
        {header('ttk', t('ac.diesIn'), true)}<td /></tr></thead>
      <tbody>{rows.map(row => {
        const isWorst = row.dps > 0 && row.dps === worst;
        const isBest = row.dps > 0 && row.dps === best;
        return <tr key={row.id} className={`${row.main ? 'bt-main' : ''} ${isWorst ? 'bt-worst' : ''} ${isBest ? 'bt-best' : ''}`}>
          <th scope="row" className="bt-name">{row.main
            ? <><span>{row.name}</span> <span className="bt-badge">{t('targets.main')}</span></>
            : <button type="button" className="bt-link" title={t('targets.promote', { name: row.name })}
              onClick={() => vm.action(() => vm.promoteExtraMonster(row.id))}>{row.name}</button>}
            {isWorst && <span className="bt-badge bt-badge--worst">{t('targets.worst')}</span>}
            {isBest && <span className="bt-badge bt-badge--best">{t('targets.best')}</span>}</th>
          <td className="bt-num">{number(row.hp)}</td>
          <td>{elementPtBr(row.elementUpper)}</td>
          <td>{sizePtBr(row.size)}</td>
          <td>{racePtBr(row.race)}</td>
          <td className="bt-num">{number(row.hitFor100)}</td>
          <td className="bt-num">{row.critRate == null ? '—' : `${formatNumber(row.critRate, 0, 1)}%`}</td>
          <td className="bt-num bt-dmg">{number(row.perCycle)}</td>
          <td className="bt-num bt-dmg">{number(row.dps)}</td>
          <td className="bt-num">{row.ttkText ?? '—'}</td>
          <td className="bt-act">{!row.main && <button type="button" className="bt-remove" aria-label={t('targets.remove', { name: row.name })}
            title={t('targets.remove', { name: row.name })} onClick={() => vm.action(() => vm.removeExtraMonster(row.id))}><Icon name="times" /></button>}</td>
        </tr>;
      })}</tbody>
    </table></div>
  </section>;
}
