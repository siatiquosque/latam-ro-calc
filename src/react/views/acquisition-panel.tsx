import { useEffect, useMemo, useRef, useState } from 'react';
import { useText } from '../state/use-text';
import { BuildAnalysis } from '../services/build-analysis';
import { ApplicationServices } from '../services/application';
import { TextKey } from '../../app/i18n';

type Odds = { numerator: number; denominator: number };
const oddsText = (odds: Odds) => `${odds.numerator}/${odds.denominator}`;
const ALERTS = ['expired', 'exceptional', 'lowChance'] as const;
const ROUTE_AVAILABILITY: Record<string, TextKey> = { active: 'acq.confirmed', unknown: 'acq.unconfirmed', future: 'acq.future', expired: 'acq.expired' };
const httpUrl = (url: unknown) => typeof url === 'string' && /^https?:\/\//.test(url) ? url : undefined;

/** Runs one read-only acquisition request in its own worker; the optimized result on screen is never touched. */
function useAcquisition(services: ApplicationServices) {
  const runner = useMemo(() => new BuildAnalysis(services.data), [services.data]);
  useEffect(() => () => runner.cancel(), [runner]);
  return runner;
}

function RouteDetail({ itemId, services }: { itemId: number; services: ApplicationServices }) {
  const t = useText();
  const runner = useAcquisition(services);
  const [state, setState] = useState<{ data?: Record<string, any>; error?: string }>({});
  const started = useRef(false);
  const load = () => {
    if (started.current) return;
    started.current = true;
    runner.run({ mode: 'acquisitionItem', args: { itemId }, maxSearchMs: 0, maxSolves: 0 })
      .then(data => setState({ data }), (cause: Error) => { if (cause.name !== 'AbortError') setState({ error: cause.message }); });
  };
  const { data, error } = state;
  return <details onToggle={event => event.currentTarget.open && load()}><summary>{t('acq.details')}</summary>
    {error && <p role="alert" className="improve-alert">{t('acq.failed', { reason: error })}</p>}
    {!data && !error && <p role="status">{t('acq.detailsLoading')}</p>}
    {data && !data['routes']?.length && <p>{t('acq.detailsNone')}</p>}
    {data?.['routes']?.map((route: any) => <section key={route.id} className="acq-route">
      <strong>{route.label}</strong>
      <p>{[t(ROUTE_AVAILABILITY[route.availability as string] ?? 'acq.unconfirmed'), t('acq.review', { review: route.review }),
        route.drop ? (route.drop.probability ? t('acq.odds', { odds: oddsText(route.drop.probability) }) : t('acq.oddsUnknown')) : route.chance === 'unknown' ? t('acq.oddsUnknown') : undefined,
        route.period?.end ? t('acq.until', { date: route.period.end }) : undefined].filter(Boolean).join(' · ')}</p>
      {!!route.requires?.length && <ul>{route.requires.map((text: string, i: number) => <li key={i}>{text}</li>)}</ul>}
      {!!route.unknowns?.length && <ul className="acq-unknowns">{route.unknowns.map((text: string, i: number) => <li key={i}>{text}</li>)}</ul>}
      <p>{route.sources?.map((id: string, i: number) => {
        const url = httpUrl(data['sources']?.[id]?.url);
        return <span key={id}>{i ? ', ' : ''}{url ? <a href={url} target="_blank" rel="noopener noreferrer">{new URL(url).hostname}</a> : id}</span>;
      })}</p>
    </section>)}
  </details>;
}

function Entry({ entry, services }: { entry: any; services: ApplicationServices }) {
  const t = useText();
  const { route = {}, availability, chance } = entry;
  const where = route.monsterId != null ? [t('acq.dropFrom', { monster: route.monsterId }), route.map ? t('acq.map', { map: route.map }) : undefined] : [route.method];
  const chanceText = route.odds ? t('acq.odds', { odds: route.odds }) : chance === 'unknown' ? t('acq.oddsUnknown') : chance === 'certain' ? t('acq.oddsCertain') : undefined;
  const availabilityText = availability === 'confirmed' ? t('acq.confirmed') : availability === 'expired_only' ? t('acq.expired')
    : availability === 'future_only' ? t('acq.future') : t('acq.unconfirmed');
  return <li className={`acq-entry${entry.alert ? ` acq-${entry.alert}` : ''}`}>
    <strong>{entry.name}</strong> <small>({t(`acq.aspect.${entry.aspect}` as TextKey)}{entry.paths ? ` ×${entry.paths.length}` : ''})</small>
    {entry.alert && <> <mark>{t(`acq.alert.${entry.alert}` as TextKey)}</mark></>}
    <p>{[t('acq.documented'), availabilityText, chanceText, route.until ? t('acq.until', { date: route.until }) : undefined].filter(Boolean).join(' · ')}</p>
    <p>{[...where, ...(route.requires ?? [])].filter(Boolean).join(' · ')}{entry.otherRoutes ? ` · ${t('acq.otherRoutes', { count: entry.otherRoutes })}` : ''}</p>
    <RouteDetail itemId={entry.itemId} services={services} />
  </li>;
}

/**
 * Collapsible acquisition summary of what the optimized build changes. It is fetched when the player opens it, from the shared
 * acquisition service in the analysis worker; the damage engine is not involved. A failure here never touches the result above.
 */
export default function AcquisitionPanel({ services, original, patch }: { services: ApplicationServices; original: unknown; patch: unknown }) {
  const t = useText();
  const runner = useAcquisition(services);
  const [state, setState] = useState<{ brief?: Record<string, any>; error?: string }>({});
  const started = useRef(false);
  const load = () => {
    if (started.current) return;
    started.current = true;
    runner.run({ mode: 'acquisition', args: { original, patch } as never, maxSearchMs: 0, maxSolves: 0 })
      .then(brief => setState({ brief }), (cause: Error) => { if (cause.name !== 'AbortError') setState({ error: cause.message }); });
  };
  const { brief, error } = state;
  const configuration = brief?.['configuration'];
  const missing = configuration?.withoutProcedure;
  return <details className="acq-panel" onToggle={event => event.currentTarget.open && load()}>
    <summary>{t('acq.title')}</summary>
    {error && <p role="alert" className="improve-alert">{t('acq.failed', { reason: error })}</p>}
    {!brief && !error && <p role="status">{t('acq.loading')}</p>}
    {brief && configuration.level === 'unchanged' && <p>{t('acq.unchanged')}</p>}
    {brief && configuration.level !== 'unchanged' && <>
      <p>{t('acq.summary', { changed: configuration.components.changed, documented: configuration.components.documented, preserved: configuration.components.preserved })}</p>
      <p className="improve-alert">{t(`acq.level.${configuration.level}` as TextKey)}</p>
      <p>{t('acq.exactNote')}</p>
      {ALERTS.some(kind => brief['alerts'][kind]) && <ul className="acq-alerts">{ALERTS.filter(kind => brief['alerts'][kind]).map(kind =>
        <li key={kind}><strong>{t(`acq.alert.${kind}` as TextKey)}:</strong> {brief['alerts'][kind].join(', ')}</li>)}</ul>}
      {configuration.unconfirmedLatam > 0 && <p>{t('acq.alert.unconfirmed', { count: configuration.unconfirmedLatam })}</p>}
      {configuration.unknownChance > 0 && <p>{t('acq.alert.unknownChance', { count: configuration.unknownChance })}</p>}
      <ul className="acq-list">{brief['changed'].map((entry: any) => <Entry key={entry.paths?.[0] ?? entry.path} entry={entry} services={services} />)}</ul>
      {brief['omitted'] > 0 && <p>{t('acq.omitted', { count: brief['omitted'] })}</p>}
      {missing.count > 0 && <details><summary>{t('acq.noProcedure', { count: missing.count })}</summary>
        <p>{t('acq.noProcedureNote')}</p>
        <ul>{Object.entries<number>(missing.byAspect).map(([aspect, count]) => <li key={aspect}>{t(`acq.aspect.${aspect}` as TextKey)}: {count}</li>)}</ul>
        {!!missing.named.length && <p>{missing.named.join(', ')}{missing.moreNamed ? ` +${missing.moreNamed}` : ''}</p>}
      </details>}
      <p><small>{t('acq.revision', { revision: brief['knowledgeRevision'], date: brief['asOf'] })}. {t('acq.sources', { sources: Object.entries<number>(brief['sources']).map(([host, count]) => `${host} (${count})`).join(', ') || '—' })}</small></p>
    </>}
  </details>;
}
