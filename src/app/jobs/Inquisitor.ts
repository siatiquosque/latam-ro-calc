import { JOB_4_MAX_JOB_LEVEL, JOB_4_MIN_MAX_LEVEL } from '../app-config';
import { EquipmentSummaryModel } from '../models/equipment-summary.model';
import { AdditionalBonusInput } from '../models/info-for-class.model';
import { addBonus, floor, genSkillList } from '../utils';
import { Sura } from './Sura';
import { ActiveSkillModel, AtkSkillFormulaInput, AtkSkillModel, PassiveSkillModel } from './_character-base.abstract';
import { ClassName } from './_class-name';


/** Every level of a skill, so a recording made below the max can be simulated as recorded. */
const levelList = (name: string, maxLv: number) =>
  Array.from({ length: maxLv }, (_, i) => ({ label: `${name} Nv${i + 1}`, value: `${name}==${i + 1}` }));

/**
 * The three Auréolas, lowest to highest. Each is a state the brand follow-ups require —
 * the client prints "Apenas durante [Auréola ...]" on every one of the six — and a higher
 * aura stands in for the lower ones (rAthena `skill_check_condition_castbegin` ORs them
 * the same way). They change no number: the client text and bROWiki give each one a
 * single effect, letting Ruína / Combo Rápido / Garra de Tigre skip their sphere cost, and
 * rAthena's status.cpp and battle.cpp never read the three status effects at all. The
 * toggles exist so the buff list is complete and so a chosen aura tells which brand
 * skills it allows; with none chosen every skill is available, as before
 * (tracker oNlijThpU24tnEVE91wv).
 */
const AURAS = ['First Faith Power', 'Judge', 'Third Exor Flame'] as const;
type Aura = typeof AURAS[number];
/** What "Requer:" prints when the chosen aura is too low for a skill, by the lowest aura it accepts. */
const AURA_REQUIREMENT: Record<Aura, string> = {
  'First Faith Power': 'Auréola do Poder, do Juiz ou das Chamas',
  'Judge': 'Auréola do Juiz ou das Chamas',
  'Third Exor Flame': 'Auréola das Chamas',
};

/**
 * Stat and trait weights per job level, copied from the official Gravity page
 * https://ro.gnjoy.com/guide/runemidgarts/jobview.asp?lineseq=6&jobgamecode=4262 (levels 1-65).
 * Level 50 also reads the same in a LATAM replay's ZC_COUPLESTATUS (inq-mao-explosiva-crit.rrf).
 * Levels 66-70 repeat 65, the last the page lists.
 */
const jobBonusTable: Record<number, [number, number, number, number, number, number]> = {
  1: [0, 1, 0, 0, 1, 0],
  2: [1, 1, 0, 0, 2, 0],
  3: [1, 1, 0, 1, 2, 0],
  4: [3, 1, 0, 1, 2, 0],
  5: [4, 1, 0, 1, 2, 0],
  6: [5, 1, 0, 1, 2, 0],
  7: [5, 1, 0, 1, 3, 0],
  8: [5, 2, 0, 2, 3, 0],
  9: [6, 2, 0, 2, 4, 0],
  10: [6, 3, 0, 2, 4, 0],
  11: [6, 3, 0, 2, 5, 0],
  12: [6, 4, 1, 2, 5, 0],
  13: [6, 4, 1, 2, 5, 0],
  14: [6, 5, 2, 2, 5, 0],
  15: [6, 5, 2, 3, 5, 1],
  16: [7, 5, 2, 3, 5, 1],
  17: [7, 5, 3, 4, 5, 1],
  18: [8, 5, 3, 5, 5, 1],
  19: [8, 5, 4, 5, 6, 1],
  20: [8, 5, 5, 5, 7, 1],
  21: [8, 6, 5, 5, 7, 1],
  22: [9, 7, 5, 5, 7, 1],
  23: [9, 8, 5, 5, 7, 1],
  24: [9, 8, 5, 5, 8, 1],
  25: [9, 9, 5, 5, 8, 1],
  26: [10, 9, 5, 5, 8, 1],
  27: [10, 9, 5, 5, 8, 1],
  28: [10, 9, 5, 5, 8, 1],
  29: [10, 9, 5, 5, 8, 1],
  30: [10, 9, 5, 6, 8, 1],
  31: [10, 9, 5, 6, 8, 1],
  32: [10, 9, 5, 6, 8, 1],
  33: [10, 9, 5, 6, 8, 1],
  34: [10, 9, 5, 6, 8, 1],
  35: [10, 9, 5, 6, 8, 1],
  36: [10, 9, 5, 6, 8, 1],
  37: [10, 9, 5, 6, 8, 1],
  38: [10, 9, 5, 6, 8, 1],
  39: [10, 9, 5, 6, 8, 1],
  40: [10, 9, 5, 6, 8, 1],
  41: [10, 9, 5, 6, 8, 1],
  42: [10, 9, 5, 7, 8, 1],
  43: [10, 10, 5, 7, 8, 1],
  44: [10, 10, 5, 7, 8, 1],
  45: [10, 10, 5, 8, 8, 1],
  46: [10, 10, 5, 8, 8, 1],
  47: [10, 10, 6, 8, 8, 1],
  48: [10, 10, 6, 8, 8, 1],
  49: [10, 10, 6, 8, 8, 1],
  50: [10, 10, 6, 8, 8, 1],
  51: [10, 10, 6, 8, 8, 1],
  52: [10, 10, 6, 8, 8, 1],
  53: [10, 10, 6, 8, 8, 1],
  54: [10, 10, 6, 8, 8, 1],
  55: [10, 10, 6, 8, 8, 1],
  56: [10, 10, 6, 8, 8, 1],
  57: [10, 10, 6, 8, 8, 1],
  58: [10, 10, 6, 8, 8, 1],
  59: [10, 10, 6, 8, 8, 1],
  60: [10, 10, 6, 8, 8, 1],
  61: [10, 10, 6, 8, 8, 1],
  62: [10, 10, 6, 8, 8, 1],
  63: [10, 10, 6, 8, 8, 1],
  64: [10, 10, 6, 8, 9, 1],
  65: [10, 10, 6, 8, 9, 1],
  66: [10, 10, 6, 8, 9, 1],
  67: [10, 10, 6, 8, 9, 1],
  68: [10, 10, 6, 8, 9, 1],
  69: [10, 10, 6, 8, 9, 1],
  70: [10, 10, 6, 8, 9, 1],
};

const traitBonusTable: Record<number, [number, number, number, number, number, number]> = {
  1: [0, 0, 0, 0, 0, 0],
  2: [0, 0, 0, 0, 0, 0],
  3: [1, 0, 0, 0, 0, 0],
  4: [1, 0, 0, 0, 0, 0],
  5: [2, 0, 0, 0, 0, 0],
  6: [2, 0, 0, 0, 0, 0],
  7: [3, 0, 0, 0, 0, 0],
  8: [3, 0, 0, 0, 0, 0],
  9: [3, 0, 0, 0, 0, 0],
  10: [3, 0, 0, 0, 0, 0],
  11: [3, 1, 0, 0, 0, 0],
  12: [3, 1, 0, 0, 0, 0],
  13: [3, 1, 1, 0, 0, 0],
  14: [3, 1, 1, 0, 0, 0],
  15: [3, 1, 1, 0, 0, 0],
  16: [3, 2, 1, 0, 0, 0],
  17: [3, 2, 1, 0, 0, 0],
  18: [3, 2, 1, 0, 0, 0],
  19: [3, 2, 1, 0, 0, 0],
  20: [3, 2, 1, 0, 0, 0],
  21: [3, 2, 1, 0, 0, 0],
  22: [3, 2, 1, 0, 0, 0],
  23: [3, 2, 1, 0, 0, 0],
  24: [3, 2, 1, 0, 0, 0],
  25: [3, 2, 1, 0, 0, 0],
  26: [3, 2, 1, 0, 0, 0],
  27: [3, 2, 1, 0, 0, 1],
  28: [3, 2, 1, 0, 1, 1],
  29: [3, 2, 1, 0, 1, 2],
  30: [4, 2, 1, 0, 1, 2],
  31: [5, 2, 1, 0, 1, 2],
  32: [5, 2, 2, 0, 1, 3],
  33: [5, 2, 2, 1, 1, 3],
  34: [5, 2, 2, 2, 1, 3],
  35: [6, 2, 2, 2, 1, 3],
  36: [6, 3, 2, 2, 1, 3],
  37: [6, 3, 2, 2, 2, 3],
  38: [6, 3, 2, 2, 3, 3],
  39: [6, 3, 2, 2, 3, 4],
  40: [6, 3, 2, 2, 4, 4],
  41: [6, 3, 2, 3, 4, 4],
  42: [6, 3, 2, 3, 4, 5],
  43: [7, 3, 2, 3, 4, 5],
  44: [7, 3, 2, 3, 5, 5],
  45: [7, 4, 2, 3, 5, 5],
  46: [7, 5, 2, 3, 5, 5],
  47: [7, 5, 3, 3, 5, 5],
  48: [7, 5, 3, 3, 5, 6],
  49: [8, 6, 3, 3, 5, 6],
  50: [9, 6, 4, 3, 5, 6],
  51: [10, 6, 4, 3, 5, 6],
  52: [10, 7, 4, 3, 5, 6],
  53: [10, 8, 4, 3, 5, 6],
  54: [10, 8, 4, 3, 5, 6],
  55: [11, 8, 5, 3, 5, 6],
  56: [11, 8, 5, 3, 5, 6],
  57: [11, 8, 6, 3, 5, 6],
  58: [11, 8, 6, 3, 5, 6],
  59: [11, 8, 6, 3, 6, 6],
  60: [11, 8, 6, 3, 6, 6],
  61: [11, 8, 6, 3, 7, 6],
  62: [11, 8, 6, 3, 7, 6],
  63: [11, 8, 6, 3, 7, 6],
  64: [11, 8, 7, 3, 7, 6],
  65: [11, 8, 7, 3, 7, 6],
  66: [11, 8, 7, 3, 7, 6],
  67: [11, 8, 7, 3, 7, 6],
  68: [11, 8, 7, 3, 7, 6],
  69: [11, 8, 7, 3, 7, 6],
  70: [11, 8, 7, 3, 7, 6],
};

export class Inquisitor extends Sura {
  protected override CLASS_NAME = ClassName.Inquisitor;
  protected override JobBonusTable = jobBonusTable;
  protected override TraitBonusTable = traitBonusTable;

  protected override minMaxLevel = JOB_4_MIN_MAX_LEVEL;
  protected override maxJob = JOB_4_MAX_JOB_LEVEL;

  private readonly classNames4th = [ClassName.Only_4th, ClassName.Inquisitor];
  private readonly atkSkillList4th: AtkSkillModel[] = [
    {
      name: 'First Brand',
      scaling: { bonusKeys: ['pow', 'allTrait'], formulaText: '(nível da habilidade × 450 + POD × 3) × nível base / 100.' },
      label: '[V2] First Brand Lv5',
      value: 'First Brand==5',
      levelList: levelList('First Brand', 5),
      acd: 0,
      fct: 0,
      vct: 0,
      cd: 0.3,
      isMelee: true,
      formula: (input: AtkSkillFormulaInput): number => {
        const { model, skillLevel, status } = input;
        const { totalPow } = status;
        const baseLevel = model.level;

        return (skillLevel * 450 + totalPow * 3) * (baseLevel / 100);
      },
    },
    {
      name: 'Second Faith',
      scaling: { bonusKeys: ['pow', 'allTrait'], formulaText: '(nível da habilidade × 500 + POD × 4) × nível base / 100.' },
      label: '[V2] Second Faith Lv5',
      value: 'Second Faith==5',
      levelList: levelList('Second Faith', 5),
      verifyItemFn: () => this.requiresAura('First Faith Power'),
      acd: 0,
      fct: 0,
      vct: 0,
      cd: 0.7,
      isMelee: true,
      hit: 2,
      formula: (input: AtkSkillFormulaInput): number => {
        const { model, skillLevel, status } = input;
        const { totalPow } = status;
        const baseLevel = model.level;

        return (skillLevel * 500 + totalPow * 4) * (baseLevel / 100);
      },
    },
    {
      name: 'Third Punish',
      scaling: { bonusKeys: ['pow', 'allTrait'], formulaText: '(nível da habilidade × 650 + POD × 5) × nível base / 100.' },
      label: '[V2] Third Punish Lv5',
      value: 'Third Punish==5',
      levelList: levelList('Third Punish', 5),
      verifyItemFn: () => this.requiresAura('First Faith Power'),
      acd: 0,
      fct: 0,
      vct: 0,
      cd: 1,
      isMelee: true,
      canCri: true,
      baseCriPercentage: 1,
      criDmgPercentage: 0.5,
      totalHit: 2,
      formula: (input: AtkSkillFormulaInput): number => {
        const { model, skillLevel, status } = input;
        const { totalPow } = status;
        const baseLevel = model.level;

        return (skillLevel * 650 + totalPow * 5) * (baseLevel / 100);
      },
    },
    {
      name: 'Second Judgement',
      scaling: { bonusKeys: ['pow', 'allTrait'], formulaText: '(nível da habilidade × 525 + POD × 4) × nível base / 100.' },
      label: '[V2] Second Judgement Lv5',
      value: 'Second Judgement==5',
      levelList: levelList('Second Judgement', 5),
      verifyItemFn: () => this.requiresAura('Judge'),
      acd: 0,
      fct: 0,
      vct: 0,
      cd: 0.7,
      isMelee: true,
      hit: 3,
      formula: (input: AtkSkillFormulaInput): number => {
        const { model, skillLevel, status } = input;
        const { totalPow } = status;
        const baseLevel = model.level;

        // 525% per level is the client's table (Toque Intercessor: 525 / 1.050 / ... /
        // 2.625%); the 500 this carried was the [V2] blog figure and left every one of
        // the 25 Lv5 packets of inq-brand-rotation-13-dummies.rrf 4,5% above the ceiling
        // while Estigma and Técnica da Mão Explosiva fit to the roll on the same build.
        return (skillLevel * 525 + totalPow * 4) * (baseLevel / 100);
      },
    },
    {
      name: 'Third Consecration',
      scaling: { bonusKeys: ['pow', 'allTrait'], formulaText: '(nível da habilidade × 650 + POD × 5) × nível base / 100.' },
      label: '[V2] Third Consecration Lv5',
      value: 'Third Consecration==5',
      levelList: levelList('Third Consecration', 5),
      verifyItemFn: () => this.requiresAura('Judge'),
      acd: 0,
      fct: 0,
      vct: 0,
      cd: 1,
      isMelee: true,
      totalHit: 5,
      formula: (input: AtkSkillFormulaInput): number => {
        const { model, skillLevel, status } = input;
        const { totalPow } = status;
        const baseLevel = model.level;

        return (skillLevel * 650 + totalPow * 5) * (baseLevel / 100);
      },
    },
    {
      name: 'Second Flame',
      scaling: { bonusKeys: ['pow', 'allTrait'], formulaText: '(nível da habilidade × 550 + POD × 4) × nível base / 100.' },
      label: '[V2] Second Flame Lv5',
      value: 'Second Flame==5',
      levelList: levelList('Second Flame', 5),
      verifyItemFn: () => this.requiresAura('Third Exor Flame'),
      acd: 0,
      fct: 0,
      vct: 0,
      cd: 0.7,
      isMelee: true,
      formula: (input: AtkSkillFormulaInput): number => {
        const { model, skillLevel, status } = input;
        const { totalPow } = status;
        const baseLevel = model.level;

        return (skillLevel * 550 + totalPow * 4) * (baseLevel / 100);
      },
    },
    {
      name: 'Third Flame Bomb',
      scaling: { resources: ['hp'], bonusKeys: ['hp', 'hpPercent', 'vit', 'allStatus', 'pow', 'allTrait'],
        formulaText: 'A razão inclui HP máximo / 5, nível da habilidade e POD, escalados pelo nível base. Os coeficientes variam com a versão da fórmula.' },
      label: '[V2] Third Flame Bomb Lv5',
      value: 'Third Flame Bomb==5',
      levelList: levelList('Third Flame Bomb', 5),
      verifyItemFn: () => this.requiresAura('Third Exor Flame'),
      acd: 0,
      fct: 0,
      vct: 0,
      cd: 1,
      // Each hit applies the full ratio: 0–5 spheres = 1, 6–10 = 2, 11–15 = 3.
      totalHit: input => Math.max(1, Math.min(3, Math.ceil(input.skills.activeLevel('Total Spirit') / 5))),
      isMelee: true,
      formula: (input: AtkSkillFormulaInput): number => {
        const { model, skillLevel, status, maxHp } = input;
        const { totalPow } = status;
        const baseLevel = model.level;

        return (skillLevel * 650 + totalPow * 5 + floor(maxHp / 5)) * (baseLevel / 100);
      },
    },
    {
      name: 'Explosion Blaster',
      scaling: { bonusKeys: ['pow', 'allTrait'], formulaText: '(nível da habilidade × 650 + POD × 3) × nível base / 100; com Oleum Sanctum ativo: (nível da habilidade × 850 + POD × 5) × nível base / 100.' },
      label: '[V2] Explosion Blaster Lv5',
      value: 'Explosion Blaster==5',
      levelList: levelList('Explosion Blaster', 5),
      acd: 0,
      fct: 0,
      vct: 0,
      cd: 0.7,
      canCri: true,
      baseCriPercentage: 1,
      criDmgPercentage: 0.5,
      formula: (input: AtkSkillFormulaInput): number => {
        const { model, skillLevel, status } = input;
        const { totalPow } = status;
        const baseLevel = model.level;

        if (this.isSkillActive('Oleum Sanctum')) {
          return (skillLevel * 850 + totalPow * 5) * (baseLevel / 100);
        }

        return (skillLevel * 650 + totalPow * 3) * (baseLevel / 100);
      },
    },
    {
      name: 'Massive Flame Blaster',
      scaling: { bonusKeys: ['pow', 'allTrait'], formulaText: '(nível da habilidade × (800, ou 1100 contra Demônio e Bruto) + POD × 10) × nível base / 100.' },
      label: '[V2] Massive Flame Blaster Lv10',
      value: 'Massive Flame Blaster==10',
      levelList: levelList('Massive Flame Blaster', 10),
      acd: 0,
      fct: 0,
      vct: 0,
      cd: 5,
      canCri: true,
      baseCriPercentage: 1,
      criDmgPercentage: 0.5,
      formula: (input: AtkSkillFormulaInput): number => {
        const { model, skillLevel, status, monster } = input;
        const { totalPow } = status;
        const baseLevel = model.level;
        const raceBonus = monster.isRace('demon', 'brute') ? 300 : 0;

        return (skillLevel * (800 + raceBonus) + totalPow * 10) * (baseLevel / 100);
      },
    },
  ];
  private readonly activeSkillList4th: ActiveSkillModel[] = [
    // The three Faiths are mutually exclusive (only one active at a time), like the
    // Soul Reaper "Espírito" souls — handled via exclusiveGroup in onSkillClassChange.
    {
      name: 'Sincere Faith',
      label: 'Sincere Faith',
      exclusiveGroup: 'faith',
      inputType: 'dropdown',
      dropdown: genSkillList(5),
    },
    {
      name: 'Firm Faith',
      label: 'Firm Faith',
      exclusiveGroup: 'faith',
      inputType: 'dropdown',
      dropdown: genSkillList(5),
    },
    {
      name: 'Powerful Faith',
      label: 'Powerful Faith',
      exclusiveGroup: 'faith',
      inputType: 'dropdown',
      dropdown: genSkillList(5),
    },
    // The three Auréolas: one state at a time (bROWiki: "Você não pode ter as 3 auréolas
    // ativas ao mesmo tempo, uma deve sobrepor a outra"), see AURAS above.
    {
      name: 'First Faith Power',
      label: 'First Faith Power',
      exclusiveGroup: 'aura',
      inputType: 'selectButton',
      dropdown: [
        { label: 'Sim', value: 5, isUse: true },
        { label: 'Não', value: 0, isUse: false },
      ],
    },
    {
      name: 'Judge',
      label: 'Judge',
      exclusiveGroup: 'aura',
      inputType: 'selectButton',
      dropdown: [
        { label: 'Sim', value: 5, isUse: true },
        { label: 'Não', value: 0, isUse: false },
      ],
    },
    {
      name: 'Third Exor Flame',
      label: 'Third Exor Flame',
      exclusiveGroup: 'aura',
      inputType: 'selectButton',
      dropdown: [
        { label: 'Sim', value: 5, isUse: true },
        { label: 'Não', value: 0, isUse: false },
      ],
    },
    {
      name: 'Oleum Sanctum',
      label: 'Oleum Sanctum 5',
      isDebuff: true,
      inputType: 'selectButton',
      dropdown: [
        { label: 'Sim', value: 5, isUse: true, bonus: { oleumSanctum: 5 * 3 } },
        { label: 'Não', value: 0, isUse: false },
        // { label: 'Nv 1', value: 1, isUse: true, bonus: { oleumSanctum: 1 * 3 } },
        // { label: 'Nv 2', value: 2, isUse: true, bonus: { oleumSanctum: 2 * 3 } },
        // { label: 'Nv 3', value: 3, isUse: true, bonus: { oleumSanctum: 3 * 3 } },
        // { label: 'Nv 4', value: 4, isUse: true, bonus: { oleumSanctum: 4 * 3 } },
      ],
    },
  ];
  private readonly passiveSkillList4th: PassiveSkillModel[] = [
    {
      name: 'Will of Faith',
      label: 'Will of Faith',
      inputType: 'dropdown',
      dropdown: genSkillList(10),
    },
  ];

  constructor() {
    super();

    this.inheritSkills({
      activeSkillList: this.activeSkillList4th,
      atkSkillList: this.atkSkillList4th,
      passiveSkillList: this.passiveSkillList4th,
      classNames: this.classNames4th,
    });
  }

  /**
   * The "Requer:" text for a brand skill that needs at least `lowest` — empty when the
   * chosen aura is high enough, and empty when none is chosen at all, so a build that never
   * touched the toggles keeps simulating every skill.
   */
  private requiresAura(lowest: Aura): string {
    const chosen = AURAS.findIndex((aura) => this.isSkillActive(aura));
    if (chosen === -1 || chosen >= AURAS.indexOf(lowest)) return '';

    return AURA_REQUIREMENT[lowest];
  }

  override setAdditionalBonus(params: AdditionalBonusInput): EquipmentSummaryModel {
    super.setAdditionalBonus(params);

    const { totalBonus, weapon } = params;

    const willOfFaithLv = this.learnLv('Will of Faith');
    if (willOfFaithLv > 0 && weapon.isType('fist')) {
      addBonus(totalBonus, 'p_race_demon', willOfFaithLv + 2);
      addBonus(totalBonus, 'p_race_undead', willOfFaithLv + 2);
    }

    // Only one Faith can be active at a time (exclusiveGroup 'faith').
    // Per-level bonuses follow the LATAM client tables (skills 5242/5239/5238).
    if (this.isSkillActive('Sincere Faith')) {
      const level = this.activeSkillLv('Sincere Faith');
      addBonus(totalBonus, 'aspd', level);
      addBonus(totalBonus, 'perfectHit', level * 4);
    } else if (this.isSkillActive('Firm Faith')) {
      const level = this.activeSkillLv('Firm Faith');
      addBonus(totalBonus, 'hpPercent', level * 2);
      addBonus(totalBonus, 'res', level * 8);
    } else if (this.isSkillActive('Powerful Faith')) {
      const level = this.activeSkillLv('Powerful Faith');
      addBonus(totalBonus, 'atk', 5 + level * 5);
      addBonus(totalBonus, 'pAtk', 5 + level * 2);
    }

    return totalBonus;
  }
}
