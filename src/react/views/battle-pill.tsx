import { useEffect, useState } from 'react';
import { elementPtBr, racePtBr, sizePtBr } from '../../app/constants/monster-i18n';
import { formatNumber } from '../../app/utils/format-number';
import { describeTarget } from '../state/extra-targets';
import { useText } from '../state/use-text';
import './battle-pill.css';

/** Whether any battle card's DPS strip is on screen; the pill only fills in when none is. */
function useHeroOffscreen(): boolean {
  const [offscreen, setOffscreen] = useState(false);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const strips = Array.from(document.querySelectorAll<HTMLElement>('.hud-hero-strip'));
      // A strip in a hidden pane or a closed section has no boxes at all.
      const onScreen = strips.some(strip => {
        if (!strip.getClientRects().length) return false;
        const rect = strip.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < window.innerHeight;
      });
      setOffscreen(!onScreen);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    schedule();
    // Capture: the page scrolls in `window` today, but a nested scroller should count too.
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    // The strip mounts, unmounts and moves with the result, the pane and the sections.
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-pane'] });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      observer.disconnect();
    };
  }, []);
  return offscreen;
}

const percent = (before: number, after: number) => before > 0 ? ((after - before) / before) * 100 : null;
const number = (value: number | null | undefined) => value == null ? '—' : formatNumber(Math.round(value));

/**
 * The battle card in miniature, pinned to the corner while the card is out of sight: who
 * the target is, what the build does to it and how long it lasts. It reads the figures the
 * card reads, so it follows every change as the user scrolls.
 */
export function BattlePill({ vm, onGoto }: { vm: any; onGoto: () => void }) {
  const t = useText();
  const offscreen = useHeroOffscreen();
  const view = vm.rotationView;
  const cycle = view && !view.timingUnknown ? view.cycle : null;
  if (!offscreen || !cycle || !(cycle.sustainedDps > 0)) return null;

  const compared = vm.isComparing ? vm.rotationView2?.cycle : null;
  const delta = compared ? percent(cycle.sustainedDps, compared.sustainedDps) : null;
  const single = (vm.model?.rotation?.length ?? 0) === 1;
  const info = describeTarget(vm.totalSummary?.monster);
  const worst = vm.worstTargetRow;
  const showWorst = worst && worst.name !== vm.selectedMonsterName;
  return <button type="button" className="bp" onClick={onGoto} title={t('targets.pillGoto')} aria-label={t('targets.pillGoto')}>
    <span className="bp-target"><b className="bp-name">{vm.selectedMonsterName}</b>
      <span className="bp-tags">{[elementPtBr(info.elementUpper), sizePtBr(info.size), racePtBr(info.race)].filter(Boolean).map(tag => <span key={tag} className="bp-tag">{tag}</span>)}</span></span>
    <span className="bp-figs">
      <span className="bp-fig"><span className="bp-cap">{t(single ? 'hud.perUse' : 'hud.perCycle')}</span><b className="bp-big">{number(cycle.damagePerCycle)}</b></span>
      <span className="bp-fig"><span className="bp-cap">DPS</span><b className="bp-big">{number(cycle.sustainedDps)}</b>
        {delta != null && <span className={`bp-delta ${delta > 0 ? 'pos' : delta < 0 ? 'neg' : ''}`}>{delta > 0 ? '+' : ''}{formatNumber(delta, 1, 1)}%</span>}</span>
      <span className="bp-fig"><span className="bp-cap">{t('ac.diesIn')}</span><b className="bp-big">{view.ttk?.text ?? '—'}</b></span>
    </span>
    <span className="bp-meta"><span>HP {number(info.hp)}</span><span>{t('hud.hitFor100')} {number(info.hitFor100)}</span></span>
    {showWorst && <span className="bp-worst">{t('targets.pillWorst', { name: worst.name })} · {number(worst.dps)} DPS</span>}
  </button>;
}
