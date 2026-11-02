/**
 * `validate_build`: is this build one the game accepts, and one the calculator can measure? It reports, it does not repair or
 * rank. Everything it states comes from the same rules the engine and the optimizer use (class and level of the item, the slots
 * a piece or card accepts, the enchant pools, the refine cap); what it cannot check it lists under `unknowns` instead of passing.
 */
import { EQUIPMENT_SLOTS } from 'src/app/app-config/equipment-slots';
import { MVP_CARD_IDS, MVP_CARD_SOURCE } from 'src/app/constants/mvp-cards';
import { APP_VERSION } from 'src/app/core/app-version';
import { JobBuffs } from 'src/app/constants/job-buffs';
import { BaseStateCalculator } from 'src/app/core/base-state-calculator';
import { canUsedByClass } from 'src/app/utils';
import { Dataset } from '../data/dataset';
import { BuildInput, resolveBuild } from './build-input';
import { itemContext } from './item-context';
import { isCustomItem, validateCustomItems } from 'src/app/core/custom-items';
import { ensureCustomAttachment } from 'src/app/core/custom-attachments';
import { refineLimitFor } from 'src/app/core/equipment-rules';
import { canGradeItem } from 'src/app/utils/can-grade';
import { checkSkillTree, SkillTreeData, SKILL_TREE_SOURCE } from './skill-tree';

export interface BuildIssue { code: string; path: string; message: string; itemId?: number }

export interface ValidateConstraints {
  /** A card dropped by an MVP is an error. The classification is by card (`MVP_CARD_IDS`), never by the target. */
  excludeMvpCards?: boolean;
  /** Items LATAM has not shipped are errors (default true: this server is LATAM). */
  latamOnly?: boolean;
  /** Items the calculator has no mechanical data for are errors instead of warnings (default true). */
  requireCalculableItems?: boolean;
}

/** `skillTree`, when given, adds the kRO skill tree reference as warnings (it is loaded on demand, see skill-tree.ts). */
export function validateBuild(input: BuildInput, dataset: Dataset, constraints: ValidateConstraints = {}, skillTree?: SkillTreeData) {
  const { excludeMvpCards = false, latamOnly = true, requireCalculableItems = true } = constraints;
  const errors: BuildIssue[] = [];
  const warnings: BuildIssue[] = [];
  const unknowns: string[] = [
    'A árvore de habilidades é a do kRO (rAthena), não confirmada no LATAM: pré-requisitos, tetos e pontos aparecem só como avisos de referência; o orçamento de pontos soma apenas as habilidades que o calculador modela.',
    'Classificação MVP usa uma lista explícita de IDs, originalmente derivada de nomes e revisão manual; não há confirmação regional por tabela de drops.',
  ];
  // The data artifacts are built and shipped with the app, so they carry its version.
  const base = { engineVersion: APP_VERSION, dataVersion: APP_VERSION,
    sources: { skillTree: { ...SKILL_TREE_SOURCE, loaded: !!skillTree }, mvpCards: MVP_CARD_SOURCE } };

  let resolved: ReturnType<typeof resolveBuild>;
  try {
    resolved = resolveBuild(input, dataset);
  } catch (error) {
    const message = (error as Error).message;
    const code = /refino máximo/.test(message) ? 'INVALID_REFINE'
      : /não é permitido na posição|encantamento|Encantamento/.test(message) ? 'INVALID_ENCHANT'
      : /Classe .* não existe/.test(message) ? 'INCOMPATIBLE_CLASS'
      : 'INVALID_BUILD';
    errors.push({ code, path: 'build', message });

    return { valid: false, errors, warnings, unknowns, ...base };
  }

  const { model, char } = resolved;
  dataset = itemContext(dataset, resolved);
  const usable = canUsedByClass(char);

  for (const descriptor of EQUIPMENT_SLOTS) {
    const slotId = model[descriptor.key];
    const parent = resolved.items[slotId];
    let custom: ReturnType<typeof ensureCustomAttachment>;
    if (isCustomItem(parent)) {
      const state = model.customAttachments?.[descriptor.key];
      if (state && state.itemId === slotId) {
        if (![state.cards, state.enchants, state.bas].every(Array.isArray)) {
          errors.push({ code: 'INVALID_CUSTOM_ATTACHMENT', path: `customAttachments.${descriptor.key}`, message: 'Cartas, encantamentos e bônus precisam ser listas.' });
          continue;
        }
        const checked = validateCustomItems([{ ...parent, defaultCards: state.cards.filter(id => id != null), defaultEnchants: state.enchants.filter(id => id != null), defaultBas: state.bas.filter(value => value != null) }], resolved.items);
        for (const issue of checked.errors) errors.push({ code: 'INVALID_CUSTOM_ATTACHMENT', path: `customAttachments.${descriptor.key}.${issue.path}`, message: issue.message });
        if (state.refine !== undefined && (!Number.isInteger(state.refine) || state.refine < 0 || state.refine > refineLimitFor(descriptor.key, parent))) {
          errors.push({ code: 'INVALID_REFINE', path: `customAttachments.${descriptor.key}.refine`, message: 'Refino personalizado fora do limite.' });
        }
        if (state.grade !== undefined && (!['', 'D', 'C', 'B', 'A'].includes(state.grade) || state.grade && !canGradeItem(parent))) {
          errors.push({ code: 'INVALID_GRADE', path: `customAttachments.${descriptor.key}.grade`, message: 'Grau personalizado fora do limite.' });
        }
      }
      custom = ensureCustomAttachment(model, descriptor.key, parent);
    }
    const fields: { field: string; kind: 'piece' | 'card' | 'enchant'; id?: number; position?: number }[] = [
      ...(typeof slotId === 'number' && slotId > 0 ? [{ field: descriptor.key as string, kind: 'piece' as const }] : []),
      ...(custom ? custom.cards.map((id, position) => ({ field: `${descriptor.key}CustomCard${position + 1}`, kind: 'card' as const, id: id ?? 0, position })) : descriptor.cardFields.map((field) => ({ field: field as string, kind: 'card' as const }))),
      ...(custom ? custom.enchants.map((id, position) => ({ field: `${descriptor.key}CustomEnchant${position + 1}`, kind: 'enchant' as const, id: id ?? 0, position })) : descriptor.enchantFields.filter((field): field is NonNullable<typeof field> => !!field).map((field) => ({ field: field as string, kind: 'enchant' as const }))),
    ];
    for (const { field, kind, id: attachmentId, position: attachmentPosition } of fields) {
      const id = attachmentId ?? model[field];
      if (typeof id !== 'number' || id <= 0) continue;
      const path = attachmentPosition === undefined ? `gear.${field}` : `customAttachments.${descriptor.key}.${kind === 'card' ? 'cards' : 'enchants'}.${attachmentPosition}`;
      const row = dataset.itemIndex.get(id);
      if (!row) {
        errors.push({ code: 'UNKNOWN_ITEM', path, itemId: id, message: `Item ${id} não existe no LATAM nem no calculador.` });
        continue;
      }
      if (latamOnly && !row.latam) errors.push({ code: 'ITEM_NOT_AVAILABLE_LATAM', path, itemId: id, message: `${row.name} ainda não existe no LATAM.` });
      if (!row.inCalcDb) {
        (requireCalculableItems ? errors : warnings).push({ code: 'ITEM_NOT_CALCULABLE', path, itemId: id, message: `${row.name} existe no LATAM mas o calculador não tem seus bônus: o dano o trata como ausente.` });
        continue;
      }
      const record = resolved.items[id];
      if (!record) continue;
      if (kind === 'piece' && !row.slotTags?.includes(descriptor.key as never)) {
        errors.push({ code: 'INVALID_SLOT', path, itemId: id, message: `${row.name} não é usado no slot ${descriptor.key}.` });
      }
      if (kind === 'card') {
        const position = attachmentPosition ?? descriptor.cardFields.indexOf(field as never);
        const sockets = dataset.itemIndex.get(slotId as number)?.slots ?? 0;
        if (position >= sockets) errors.push({ code: 'INVALID_SLOT', path, itemId: id, message: `${row.name}: a peça só tem ${sockets} encaixe(s).` });
        const listed = descriptor.cardListKey?.replace(/List$/, '');
        const tag = listed?.startsWith('acc') ? 'accCard' : listed;
        if (tag && !row.slotTags?.includes(tag as never)) errors.push({ code: 'INVALID_SLOT', path, itemId: id, message: `${row.name} não encaixa em ${descriptor.key}.` });
        if (excludeMvpCards && MVP_CARD_IDS.has(id)) errors.push({ code: 'MVP_CARD_EXCLUDED', path, itemId: id, message: `${row.name} é carta de MVP.` });
        else if (MVP_CARD_IDS.has(id)) warnings.push({ code: 'MVP_CARD', path, itemId: id, message: `${row.name} é carta de MVP.` });
      }
      if (!usable(record)) errors.push({ code: 'INCOMPATIBLE_CLASS', path, itemId: id, message: `${row.name} não é usável por esta classe.` });
      if ((record.requiredLevel ?? 0) > (model.level ?? 0)) {
        errors.push({ code: 'REQUIRED_LEVEL', path, itemId: id, message: `${row.name} exige nível ${record.requiredLevel}; a build é nível ${model.level}.` });
      }
    }
  }

  // What the class limits changed silently is what the person did not ask for: the calculation is of another build.
  for (const { field, from, to } of resolved.adjusted) {
    const level = field === 'level' || field === 'jobLevel';
    errors.push({ code: level ? 'INVALID_LEVEL' : 'INVALID_STAT', path: level ? field : `stats.${field}`, message: `${field} ${from} está fora do limite da classe; o cálculo usou ${to}.` });
  }

  const main = ['str', 'agi', 'vit', 'int', 'dex', 'luk'] as const;
  const traits = ['pow', 'sta', 'wis', 'spl', 'con', 'crt'] as const;
  const levels = model as unknown as Record<string, number>;
  for (const stat of main) {
    if (levels[stat] > char.maxBaseStat) errors.push({ code: 'INVALID_STAT', path: `stats.${stat}`, message: `${stat} ${levels[stat]} passa do máximo da classe (${char.maxBaseStat}).` });
  }
  const traitsAllowed = char.isAllowTraitStat();
  for (const stat of traits) {
    if (!levels[stat]) continue;
    if (!traitsAllowed) errors.push({ code: 'INVALID_STAT', path: `stats.${stat}`, message: `Esta classe não usa atributos de traço (${stat} ${levels[stat]}).` });
    else if (levels[stat] > 100) errors.push({ code: 'INVALID_STAT', path: `stats.${stat}`, message: `${stat} ${levels[stat]} passa do máximo (100).` });
  }
  const points = new BaseStateCalculator().setClass(char).setLevel(model.level)
    .setMainStatusLevels(main.map((stat) => levels[stat])).setTraitStatusLevels(traits.map((stat) => levels[stat] ?? 0)).calculate().summary;
  if (points.usedPoint > points.totalPoint) {
    errors.push({ code: 'INSUFFICIENT_STAT_POINTS', path: 'stats', message: `Atributos usam ${points.usedPoint} pontos e o nível ${model.level} dá ${points.totalPoint}.` });
  }
  if (traitsAllowed && points.usedTraitPoint > points.totalTraitPoint) {
    errors.push({ code: 'INSUFFICIENT_STAT_POINTS', path: 'stats', message: `Atributos de traço usam ${points.usedTraitPoint} pontos e o nível ${model.level} dá ${points.totalTraitPoint}.` });
  }

  // A level that is not one of the skill's levels, or a name the class does not have, is turned into 0 without a word.
  const skillMaps: [string, string, readonly { name: string; dropdown: { value: number }[] }[]][] = [
    ['active', 'activeSkillMap', char.activeSkills], ['passive', 'passiveSkillMap', char.passiveSkills], ['buffs', 'skillBuffMap', JobBuffs],
  ];
  for (const [kind, key, defs] of skillMaps) {
    for (const [name, level] of Object.entries((model as unknown as Record<string, Record<string, number> | undefined>)[key] ?? {})) {
      const def = defs.find((skill) => skill.name === name);
      if (!def) errors.push({ code: 'UNKNOWN_SKILL', path: `skills.${kind}.${name}`, message: `A classe não tem a habilidade "${name}" (ignorada).` });
      else if (level && !def.dropdown.some((option) => option.value === level)) {
        errors.push({ code: 'INVALID_SKILL_LEVEL', path: `skills.${kind}.${name}`, message: `Nível ${level} não existe para "${name}" (usado: 0). Níveis: ${def.dropdown.map((option) => option.value).join(', ')}.` });
      }
    }
  }

  // The skill tree is a reference (kRO), so what it finds is a warning.
  const tree = skillTree;
  if (tree) {
    const levels = new Map<string, number>();
    const modeled = new Set<string>();
    const fold = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const [kind, key, defs] of skillMaps) {
      // Only a passive selector holds the level the player learned. A toggle (Oleum Sanctum 5/0) says whether the effect is on, so
      // an off toggle is not a missing prerequisite.
      if (kind === 'passive') for (const def of defs) modeled.add(fold(def.name));
      for (const [name, level] of Object.entries((model as unknown as Record<string, Record<string, number> | undefined>)[key] ?? {})) levels.set(fold(name), Math.max(levels.get(fold(name)) ?? 0, level)); // the same skill can sit in two maps (a toggle and a passive)
    }
    const selected = String((model as unknown as { selectedAtkSkill?: string }).selectedAtkSkill ?? '').split('==');
    if (selected[0] && Number(selected[1])) levels.set(fold(selected[0]), Math.max(levels.get(fold(selected[0])) ?? 0, Number(selected[1])));
    const classNames = [char.className, ...((char as unknown as { classNames?: unknown[] }).classNames ?? [])].map(String);
    for (const issue of checkSkillTree(tree, classNames, String(char.className), levels, modeled, model.level, model.jobLevel).issues) warnings.push(issue);
  }

  for (const message of resolved.warnings.filter((text) => !text.includes('fora do limite da classe'))) warnings.push({ code: 'ENGINE_WARNING', path: 'build', message });

  return { valid: errors.length === 0, errors, warnings, unknowns, ...base };
}
