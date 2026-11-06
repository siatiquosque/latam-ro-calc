import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '../ui/dialog';
import { useText } from '../state/use-text';
import { ApplicationServices } from '../services/application';
import { CalculatorSession } from '../state/calculator-session';
import { BuildAnalysis } from '../services/build-analysis';
import { TextKey } from '../../app/i18n';
import { objectiveFor, rotationCallBound } from '../../app/build-analysis/engine/metrics';
import { SEARCH_SLOTS as SLOTS } from '../../app/build-analysis/engine/search-slots';
import type { AnalysisRequest } from '../../app/build-analysis/browser-protocol';
import { goalSpecSchema, constraintSpecSchema } from '../../app/build-analysis/engine/goal-spec';
import { minimumEngineCalls } from '../../app/build-analysis/engine/job-budget';
import { EQUIPMENT_SLOTS } from '../../app/app-config/equipment-slots';
import type { ProcMode } from '../../app/build-analysis/engine/proc';
import './build-improvements.css';

const DEFENDED = [[9000001, 'improve.dummyNormal'], [9000002, 'improve.dummyBoss'], [9000003, 'improve.dummyNormalHigh'], [9000004, 'improve.dummyBossHigh']] as const;
type Mode = 'build' | 'slot' | 'stats' | 'explain';
const ids = (text: string) => {
  if (!text.trim()) return [];
  const values = text.trim().split(/[\s,;]+/).map(Number);
  if (values.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('improve.invalidIds');
  return [...new Set(values)];
};

/** Secondary diagnostics remain inspectable without dumping a transport payload into the UI. */
function Values({ value }: { value: any }) {
  const t = useText();
  if (value == null) return null;
  if (typeof value === 'number') return <>{new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)}</>;
  if (typeof value === 'boolean') return <>{t(value ? 'improve.yes' : 'improve.no')}</>;
  if (typeof value !== 'object') return <>{String(value)}</>;
  if (Array.isArray(value)) return <ul>{value.map((entry, i) => <li key={i}><Values value={entry} /></li>)}</ul>;
  return <dl className="improve-values">{Object.entries(value).filter(([key]) => !['patch', 'share', 'suggestedModel'].includes(key)).map(([key, entry]) =>
    <div key={key}><dt>{t(`improve.field.${key}` as TextKey) === `improve.field.${key}` ? key : t(`improve.field.${key}` as TextKey)}</dt><dd>{key === 'slot' && typeof entry === 'string' ? t(`itemSlot.${entry}` as TextKey) : /id$/i.test(key) && typeof entry === 'number' ? String(entry) : <Values value={entry} />}</dd></div>)}</dl>;
}

export default function BuildImprovements({ vm, services, onClose }: { vm: CalculatorSession; services: ApplicationServices; onClose: () => void }) {
  const t = useText();
  const runner = useMemo(() => new BuildAnalysis(services.data), [services.data]);
  const [mode, setMode] = useState<Mode>('build');
  const [equipmentMode, setEquipmentMode] = useState<'current' | 'replace'>('current');
  const [procMode, setProcMode] = useState<ProcMode>('average');
  const [procHits, setProcHits] = useState(3);
  const [profile, setProfile] = useState<'sustained' | 'burst'>('sustained');
  const [target, setTarget] = useState(vm.selectedMonster);
  const [extraTargets, setExtraTargets] = useState<number[]>([0, 0, 0, 0]);
  const [hits, setHits] = useState('');
  const [margin, setMargin] = useState('');
  const [mvpPolicy, setMvpPolicy] = useState<'allow' | 'exclude-new' | 'none'>('allow');
  const [lockedSlots, setLockedSlots] = useState<string[]>([]);
  const [lockedFields, setLockedFields] = useState<string[]>([]);
  const [slots, setSlots] = useState<string[]>([...SLOTS]);
  const [slot, setSlot] = useState('weapon');
  const [query, setQuery] = useState('');
  const [refine, setRefine] = useState(12);
  const [grade, setGrade] = useState<'none' | 'D' | 'C' | 'B' | 'A'>('A');
  const [complements, setComplements] = useState(true);
  const [exclude, setExclude] = useState('');
  const [candidates, setCandidates] = useState('');
  const [hp, setHp] = useState(0);
  const [seconds, setSeconds] = useState(60);
  const [maxSolves, setMaxSolves] = useState(10000);
  const [maxEngineCalls, setMaxEngineCalls] = useState('');
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Record<string, any>>();
  const source = useRef('');
  const active = useRef(true);
  const runId = useRef(0);
  useEffect(() => { active.current = true; return () => { active.current = false; runner.cancel(); }; }, [runner]);
  useEffect(() => {
    if (!busy) return undefined;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  const cancel = () => { if (busy && mode === 'build') runner.requestCancel(); else { runId.current++; runner.cancel(); setBusy(false); } };
  const targets = useMemo(() => Object.entries(vm.monsterDataMap).filter(([id]) => !DEFENDED.some(([dummy]) => dummy === Number(id))).map(([id, monster]) => ({ id: Number(id), name: monster.name }))
    .sort((a, b) => a.name.localeCompare(b.name)).concat(DEFENDED.map(([id, key]) => ({ id, name: t(key) }))), [vm.monsterDataMap, t]);
  const slotLabel = (key: string) => t(`itemSlot.${key}` as TextKey);
  const targetOptions = targets.map(aim => <option key={aim.id} value={aim.id}>{aim.name} ({aim.id})</option>);

  const run = async () => {
    const id = ++runId.current;
    setError(''); setResult(undefined); setElapsed(0);
    try {
      const snapshot = vm.analysisSnapshot();
      source.current = JSON.stringify(snapshot);
      const build = snapshot.build;
      const common = { build, effects: snapshot.effects, target: { monsterId: target }, maxSolves };
      const require = hp > 0 ? [{ metric: 'hp' as const, min: hp }] : [];
      const extra = { maxSearchMs: seconds * 1000, maxSolves };
      let request: Omit<AnalysisRequest, 'sources' | 'descriptions' | 'origin'>;
      if (mode === 'build') {
        if (!slots.length) throw new Error(t('improve.noSlots'));
        const chosenTargets = [target, ...extraTargets.filter(Boolean)].map(monsterId => ({ monsterId }));
        goalSpecSchema.parse({ targets: chosenTargets, ...(hits ? { maxHitsToKill: Number(hits) } : {}), ...(margin ? { margin: Number(margin) / 100 } : {}) });
        const constraints = constraintSpecSchema.parse({ mvpPolicy, lockedSlots, lockedFields, ...(equipmentMode === 'replace' ? { maxGrade: grade, maxRefine: refine } : {}) });
        const minimum = minimumEngineCalls(chosenTargets.length, procMode, rotationCallBound((snapshot.build.preset['rotation'] as string[]) ?? []));
        if (maxEngineCalls && (!Number.isSafeInteger(Number(maxEngineCalls)) || Number(maxEngineCalls) < minimum)) throw new Error(t('improve.minimumBudget', { count: minimum }));
        const fixed = equipmentMode === 'replace' ? ids(candidates) : [];
        if (fixed.length > 60) throw new Error(t('improve.tooManyCandidates'));
        if (fixed.length && !slots.includes(slot)) throw new Error(t('improve.candidateSlot'));
        request = { ...extra, mode, args: { ...common, target: undefined, targets: chosenTargets, constraints, ...(hits ? { goal: { kind: 'farm', maxHitsToKill: Number(hits), ...(margin ? { margin: Number(margin) / 100 } : {}) } } : {}), ...(maxEngineCalls ? { maxEngineCalls: Number(maxEngineCalls) } : {}), slots, profile, ...(equipmentMode === 'replace' ? { refine, maxGrade: grade } : {}), equipmentMode, procMode, procHitsPerSecond: procHits, complements, require, exclude: ids(exclude),
          ...(fixed.length ? { candidates: { [slot]: fixed } } : {}),
          detail: true } };
      } else if (mode === 'slot') request = { ...extra, mode, args: { ...common, slot, profile, query, refine, maxGrade: grade, procMode, procHitsPerSecond: procHits, topSockets: complements ? 12 : 0, includePatches: true } };
      else if (mode === 'stats') request = { ...extra, mode, args: { ...common, require, objective: objectiveFor(profile, !!(snapshot.build.preset['rotation'] as any[])?.length) } };
      else request = { ...extra, mode, args: { build, effects: snapshot.effects, target: common.target, parts: ['stages', 'contributions', 'upgrades', 'warnings'] } };
      setBusy(true);
      const output = await runner.run(request, target === vm.selectedMonster ? { id: target, monster: vm.selectedMonsterModel } : undefined, checkpoint => { if (active.current && id === runId.current) setResult(checkpoint); });
      if (active.current && id === runId.current) setResult(output);
    } catch (cause) {
      if (active.current && id === runId.current && (cause as Error).name !== 'AbortError') {
        const message = (cause as Error).message;
        setError(message === 'improve.invalidIds' ? t('improve.invalidIds') : message);
      }
    } finally { if (active.current && id === runId.current) setBusy(false); }
  };
  const compare = (model: any) => {
    try { vm.action(() => vm.compareAnalysis(model, source.current, result['analysisTarget'].id)); onClose(); }
    catch (cause) { setError((cause as Error).message); }
  };
  const format = (value: number) => Number.isFinite(value) ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value) : '—';
  return <Dialog visible modal header={t('improve.title')} onVisibleChange={() => { runId.current++; runner.cancel(); setBusy(false); onClose(); }} className="improve-dialog" style={{ width: '960px', maxWidth: '96vw' }}>
    <p>{t('improve.intro')}</p>
    <p className="text-color-secondary">{t('improve.scope')}</p>
    <p>{t('improve.evaluatedSkill')}: {vm.model.selectedAtkSkill}</p>
    <p>{t('improve.defaults')}</p>
    <form onChange={() => setResult(undefined)} onSubmit={event => { event.preventDefault(); void run(); }}>
      <fieldset disabled={busy} className="improve-controls">
        <label>{t('improve.mode')}<select value={mode} onChange={e => { setMode(e.target.value as Mode); setResult(undefined); }}>
          {(['build', 'slot', 'stats', 'explain'] as Mode[]).map(value => <option key={value} value={value}>{t(`improve.mode.${value}` as TextKey)}</option>)}</select></label>
        <label>{t('improve.target')}<select value={target} onChange={e => setTarget(Number(e.target.value))}>{targetOptions}</select></label>
        {mode === 'build' && <label>{t('improve.equipmentMode')}<select value={equipmentMode} onChange={e => setEquipmentMode(e.target.value as typeof equipmentMode)}><option value="current">{t('improve.currentGear')}</option><option value="replace">{t('improve.replaceGear')}</option></select></label>}
        {(mode === 'build' || mode === 'slot') && <>
          <label>{t('improve.procMode')}<select value={procMode} onChange={e => setProcMode(e.target.value as ProcMode)}>{(['off', 'active', 'average'] as ProcMode[]).map(value => <option key={value} value={value}>{t(`improve.proc.${value}` as TextKey)}</option>)}</select></label>
          {procMode === 'average' && <label>{t('improve.procHits')}<input type="number" min={0.1} max={30} step={0.1} required value={procHits} onChange={e => setProcHits(Number(e.target.value))} /></label>}
        </>}
        {mode !== 'explain' && <label>{t('improve.profile')}<select value={profile} onChange={e => setProfile(e.target.value as typeof profile)}><option value="sustained">{t('improve.sustained')}</option><option value="burst">{t('improve.burst')}</option></select></label>}
        {mode === 'build' && <>
          {extraTargets.map((value, index) => <label key={index}>{t('improve.additionalTarget', { count: index + 2 })}<select value={value} onChange={e => setExtraTargets(current => current.map((v, i) => i === index ? Number(e.target.value) : v))}><option value={0}>{t('improve.none')}</option>{targetOptions}</select></label>)}
          <label>{t('improve.hitsGoal')}<input type="number" min={1} step={1} value={hits} onChange={e => setHits(e.target.value)} /></label>
          <label>{t('improve.margin')}<input type="number" min={0} max={1000} step="any" value={margin} onChange={e => setMargin(e.target.value)} /></label>
          <label>{t('improve.mvpPolicy')}<select value={mvpPolicy} onChange={e => setMvpPolicy(e.target.value as typeof mvpPolicy)}>{(['allow', 'exclude-new', 'none'] as const).map(value => <option key={value} value={value}>{t(`improve.mvp.${value}` as TextKey)}</option>)}</select></label>
        </>}
        {(mode === 'build' || mode === 'slot') && <>
          {(mode === 'slot' || equipmentMode === 'replace') && <>
          <label>{t('improve.refine')}<input type="number" min={0} max={20} required value={refine} onChange={e => setRefine(Number(e.target.value))} /></label>
          <label>{t('improve.grade')}<select value={grade} onChange={e => setGrade(e.target.value as typeof grade)}>{['none', 'D', 'C', 'B', 'A'].map(value => <option key={value} value={value}>{value === 'none' ? t('improve.none') : value}</option>)}</select></label>
          </>}
          <label className="improve-check"><input type="checkbox" checked={complements} onChange={e => setComplements(e.target.checked)} />{t('improve.complements')}</label>
        </>}
        {(mode === 'slot' || mode === 'build' && equipmentMode === 'replace') && <label>{t('improve.slot')}<select value={slot} onChange={e => setSlot(e.target.value)}>{SLOTS.map(key => <option key={key} value={key}>{slotLabel(key)}</option>)}</select></label>}
        {mode === 'slot' && <label>{t('improve.query')}<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>}
        {mode === 'build' && <>
          {equipmentMode === 'replace' && <label>{t('improve.candidates')}<input value={candidates} onChange={e => setCandidates(e.target.value)} placeholder="560026, 560028" /></label>}
          <label>{t('improve.exclude')}<input value={exclude} onChange={e => setExclude(e.target.value)} /></label>
        </>}
        {(mode === 'build' || mode === 'stats') && <label>{t('improve.hp')}<input type="number" min={0} step={1} value={hp} onChange={e => setHp(Number(e.target.value))} /></label>}
        {mode !== 'explain' && <>
          <label>{t('improve.seconds')}<input type="number" min={5} max={300} required value={seconds} onChange={e => setSeconds(Number(e.target.value))} /></label>
          <label>{t(mode === 'build' ? 'improve.searchBudget' : 'improve.solves')}<input type="number" min={10} max={100000} step={1} required value={maxSolves} onChange={e => setMaxSolves(Number(e.target.value))} /></label>
          {mode === 'build' && <label>{t('improve.engineBudget')}<input type="number" min={1} step={1} value={maxEngineCalls} onChange={e => setMaxEngineCalls(e.target.value)} /></label>}
        </>}
      </fieldset>
      {mode === 'build' && <fieldset disabled={busy} className="improve-slots"><legend>{t('improve.slots')}</legend>{SLOTS.map(key =>
        <label key={key}><input type="checkbox" checked={slots.includes(key)} onChange={e => setSlots(current => e.target.checked ? [...current, key] : current.filter(value => value !== key))} />{slotLabel(key)}</label>)}</fieldset>}
      {mode === 'build' && <details><summary>{t('improve.locks')}</summary><fieldset disabled={busy}><p>{t('improve.locksHint')}</p>{EQUIPMENT_SLOTS.filter(entry => (SLOTS as readonly string[]).includes(entry.key)).map(entry => <fieldset key={entry.key}><legend>{slotLabel(entry.key)}</legend><label><input type="checkbox" checked={lockedSlots.includes(entry.key)} onChange={e => setLockedSlots(current => e.target.checked ? [...current, entry.key] : current.filter(key => key !== entry.key))} />{t('improve.lockSlot')}</label>{[entry.key, ...entry.cardFields, ...entry.enchantFields.filter(Boolean)].map(field => <label key={field}><input type="checkbox" checked={lockedFields.includes(field)} onChange={e => setLockedFields(current => e.target.checked ? [...current, field] : current.filter(key => key !== field))} />{field === entry.key ? t('improve.lockItem') : field}</label>)}</fieldset>)}</fieldset></details>}
      {(mode === 'build' || mode === 'slot') && <p>{t(mode === 'build' && equipmentMode === 'current' ? 'improve.currentHint' : 'improve.levelHint')}</p>}
      <div className="improve-actions"><button type="submit" className="ui-button" disabled={busy}>{t('improve.run')}</button>{busy && <button type="button" className="ui-button ui-button-outlined" onClick={cancel}>{t('improve.cancel')}</button>}</div>
    </form>
    {busy && <p role="status">{t('improve.running', { seconds: elapsed })} {result && t('improve.checkpointProgress')}</p>}
    {error && <p role="alert" className="improve-alert">{error}</p>}
    {result && <section aria-label={t('improve.results')} className="improve-results">
      <h3>{t('improve.results')}</h3>
      <p>{t('improve.target')}: {result['analysisTarget']?.name}</p>
      <p>{t('improve.heuristic')}</p>
      {result['stopped'] && result['stopped'] !== 'convergiu' && <p role="status" className="improve-alert">{t('improve.incomplete')}</p>}
      {result['solves'] != null && <p>{t(mode === 'build' ? 'improve.usedSearchBudget' : 'improve.usedSolves', { count: result['solves'] })}</p>}
      {mode === 'build' && result['budgetUsage'] && <><p>{t(result['checkpointFallback'] ? 'improve.checkpointCalls' : 'improve.engineCalls', { count: result['budgetUsage'].engineCalls })}</p><p className="text-color-secondary">{t(result['budgetUsage'].hardTotalLimit ? 'improve.hardBudgetNote' : 'improve.budgetNote')}</p>
        {result['budgetUsage'].stoppedReasons?.some((reason: string) => reason.includes('budget')) && <p role="status">{t('improve.stopBudget')}</p>}
        {result['budgetUsage'].stoppedReasons?.some((reason: string) => reason.startsWith('time')) && <p role="status">{t('improve.stopTime')}</p>}
        {!busy && result['budgetUsage'].stoppedBy === 'cancelled' && <p role="status">{t('improve.stopCancelled')}</p>}</>}
      {mode === 'build' && result['budgetUsage']?.stoppedBy === 'completed' && <p role="status">{t('improve.stopCompleted')}</p>}
      {mode === 'build' && result['budgetUsage']?.hardTotalLimit && <p>{t('improve.optionalReportsOmitted')}</p>}
      {result['budgetUsage']?.accountingIncomplete && <p role="status">{t('improve.accountingIncomplete')}</p>}
      {result['feasibility']?.final && <details open><summary>{t('improve.feasibility')}</summary><p>{t('improve.notImpossible')}</p><p>{t('improve.guaranteeScope')}</p><p>{t('improve.feasibilityStatus')}: {result['feasibility'].final.status}</p>{result['feasibility'].final.targets?.map((aim: any) => <article key={aim.monsterId}><strong>{aim.name || aim.monsterId}: {aim.status}</strong>{aim.kill?.reliability && <p>{t('improve.reliability')}: {aim.kill.reliability}</p>}{(aim.violations?.length > 0 || aim.unknowns?.length > 0) && <Values value={[...aim.violations, ...aim.unknowns]} />}</article>)}<details><summary>{t('improve.details')}</summary><Values value={result['feasibility'].final} /></details></details>}
      {result['patch'] && <details><summary>{t('improve.patch')}</summary><Values value={result['patch']} /></details>}
      {result['objective'] && <p>{t('improve.objective')}: {result['objective']}</p>}
      {result['procContext'] && <aside className="improve-alert"><strong>{t(`improve.proc.${result['procContext'].mode}` as TextKey)}</strong><p>{t('improve.procAssumption')}</p>
        <p>{t('improve.procOffResult')}: {format(result['procContext'].baselineOff)} → {format(result['procContext'].finalOff)}</p>
        {!!result['procContext'].uncounted?.length && <p>{t('improve.unknownProcs')}: {result['procContext'].uncounted.join(', ')}</p>}</aside>}
      {result['baseline'] && result['final'] && <div className="improve-table"><table><thead><tr><th>{t('improve.metric')}</th><th>{t('improve.before')}</th><th>{t('improve.after')}</th><th>{t('improve.gain')}</th></tr></thead><tbody>{Object.keys(result['baseline']).map(key =>
        <tr key={key}><th scope="row">{key}</th><td>{format(result['baseline'][key])}</td><td>{format(result['final'][key])}</td><td>{format(result['deltaPct']?.[key])}%</td></tr>)}</tbody></table></div>}
      {result['suggestedModel'] && <button type="button" className="ui-button" onClick={() => compare(result['suggestedModel'])}>{t('improve.compare')}</button>}
      {result['share'] && <a className="improve-link" href={result['share']} target="_blank" rel="noopener noreferrer">{t('improve.open')}</a>}
      {result['equipmentChanges']?.map((piece: any) => <article key={piece.slot} className="improve-piece"><h4>{slotLabel(piece.slot)}: {piece.before || '—'} → {piece.after || '—'}</h4>
        <div className="improve-table"><table><thead><tr><th>{t('improve.setting')}</th><th>{t('improve.before')}</th><th>{t('improve.after')}</th></tr></thead><tbody>{piece.rows.map((row: any) =>
          <tr key={row.field}><th scope="row">{row.field.replace(piece.slot, '').replace(/^Enchant/, t('improve.enchantPosition')+' ').replace(/^Card/, t('improve.cardPosition')+' ').replace(/^Refine$/, t('improve.refine')).replace(/^Grade$/, t('improve.grade')) || t('improve.item')}</th><td>{row.before || '—'}</td><td>{row.after || '—'}</td></tr>)}</tbody></table></div>
        <button type="button" className="ui-button ui-button-outlined" onClick={() => { setMode('slot'); setSlot(piece.slot); setResult(undefined); }}>{t('improve.deepenSlot')}</button></article>)}
      {result['screening'] && <details><summary>{t('improve.coverage')}</summary><Values value={result['screening']} /></details>}
      {result['reference'] && <p>{t('improve.reference')}: {result['reference'].item} · {format(result['reference'].value)} ({result['reference'].basis})</p>}
      {result['ranking'] && <div className="improve-table"><table><thead><tr><th>{t('improve.item')}</th><th>{t('improve.value')}</th><th>{t('improve.gain')}</th><th>{t('improve.action')}</th></tr></thead><tbody>{result['ranking'].map((row: any) =>
        <tr key={row.id}><td>{row.name} ({row.id}){row.sockets && <details><summary>{t('improve.sockets')}</summary><Values value={row.sockets} /></details>}{row.partners && <details><summary>{t('improve.partners')}</summary><Values value={row.partners} /></details>}</td><td>{format(row.value)}</td><td>{format(row.deltaPct)}%</td><td>{row.suggestedModel && <button type="button" className="ui-button ui-button-outlined" onClick={() => compare(row.suggestedModel)}>{t('improve.compare')}</button>}</td></tr>)}</tbody></table></div>}
      {['alerts', 'gainByKind', 'profiles', 'perTarget', 'levelCheck', 'defendedCheck', 'procs', 'aspdPotionCheck', 'alternatives', 'warnings', 'stages', 'contributions', 'upgrades'].filter(key => result[key] != null).map(key =>
        <details key={key} open={key === 'alerts' || key === 'changes'}><summary>{t(`improve.section.${key}` as TextKey)}</summary><Values value={result[key]} /></details>)}
    </section>}
  </Dialog>;
}
