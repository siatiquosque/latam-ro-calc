/**
 * The build contract agents speak: a share link as the base, sparse overrides on top,
 * or a build from scratch.
 */
import { z } from 'zod';
import { ItemOptionMap } from 'src/app/constants/item-options-table';
import { validateCataloguedRolls } from 'src/app/core/random-option-catalog';
import { MainItemWithRelations } from 'src/app/constants/item-type.enum';
import { CharacterBase } from 'src/app/jobs/_character-base.abstract';
import { MainModel } from 'src/app/models/main.model';
import { createMainModel, toRawOptionTxtList } from 'src/app/utils';
import { ClassInfo } from '../data/class-registry';
import { Dataset } from '../data/dataset';
import { applyJobBonus, applySkillMaps, clampLevels, resolveAtkSkill } from './derive';
import { strictShape } from './strict-object';
import { applyPreset } from './preset';
import { parseShare } from './share';
import { CustomItemDefinition, validateCustomItems } from 'src/app/core/custom-items';
import { ItemModel } from 'src/app/models/item.model';
import { enchantCombinationError, refineLimitFor } from 'src/app/core/equipment-rules';
import { SLOTS_BY_KEY } from 'src/app/app-config/equipment-slots';
import { enchantPoolsFor } from 'src/app/core/equipment-slot-derivation';

export const STAT_KEYS = ['str', 'agi', 'vit', 'int', 'dex', 'luk', 'pow', 'sta', 'wis', 'spl', 'con', 'crt'] as const;

/** Every model field name, taken from the model factory itself. */
const MODEL_KEYS = new Set(Object.keys(createMainModel()));

/** The main equipment slots — the ones the app can compare, each with its own relations. */
export const MAIN_ITEM_SLOTS: readonly string[] = Object.keys(MainItemWithRelations);

/** A main slot's card/enchant keys, empty for slots that have none. */
export const relatedItemKeys = (slot: string): readonly string[] => (MainItemWithRelations as Record<string, string[]>)[slot] ?? [];

/**
 * The model keys that hold an item id — every main slot plus its cards/enchants.
 * Taken from `MainItemWithRelations` rather than pattern-matched, so a new slot is
 * picked up automatically and `*Refine`/`*Grade` are excluded by construction.
 */
export const ITEM_ID_KEYS: readonly string[] = [
  ...MAIN_ITEM_SLOTS,
  ...Object.values(MainItemWithRelations).flat(),
] as string[];

/**
 * A string-keyed map the way tool clients read it: `additionalProperties` only. `z.record` also emits `propertyNames`, a
 * newer keyword that stricter clients (ChatGPT's tool validation) do not accept in a tool schema; the parsing is the same.
 */
export const stringMap = <T extends z.ZodType>(value: T) => z.object({}).catchall(value);

const buildShape = {
    share: z
      .string()
      .optional()
      .describe('Link de compartilhamento do simulador (URL completa, encurtada, fragmento antigo #/?b=… ou o token puro). Base da build.'),
    preset: stringMap(z.unknown()).optional().describe('Preset bruto, alternativa ao `share`.'),
    customItems: z.array(stringMap(z.unknown())).max(20).optional().describe('Definições de itens personalizados usadas apenas nesta requisição.'),
    customAttachments: stringMap(z.object({
      itemId: z.number().int().positive(),
      cards: z.array(z.number().int().positive().nullable()).max(4),
      enchants: z.array(z.number().int().positive().nullable()).max(4),
      bas: z.array(z.string().nullable()).max(5),
      refine: z.number().int().min(0).max(20).optional(),
      grade: z.enum(['', 'D', 'C', 'B', 'A']).optional(),
    })).optional().describe('Anexos/refino/grau dos itens personalizados, por slot.'),

    class: z.number().int().optional().describe('Id interno da classe (ex.: 4261 Elementalista). Veja list_classes.'),
    level: z.number().int().min(1).max(300).optional(),
    jobLevel: z.number().int().min(1).max(70).optional(),
    stats: z
      // 300 is a sanity guard, not a game rule: the pickers stop at 130 base / 100
      // trait, but a share link or a replay import can legitimately carry more, and
      // validating tighter than the app itself loads would reject valid builds.
      .object(Object.fromEntries(STAT_KEYS.map((k) => [k, z.number().int().min(0).max(300).optional()])) as Record<string, z.ZodOptional<z.ZodNumber>>)
      .optional()
      .describe('Atributos base alocados. POD/STA/SAB/FEI/CON/CRV só valem para classes de 4ª.'),

    gear: stringMap(z.union([z.number().int(), z.string(), z.null()]))
      .optional()
      .describe(
        'Equipamentos por slot: weapon, weaponRefine, weaponCard1..4, weaponEnchant0..3, headUpper, armor, shield, garment, boot, accLeft, accRight, shadow*, costume*, ammo, pet. Use null para limpar.',
      ),

    atkSkill: z.string().optional().describe('Habilidade ofensiva no formato "Nome==Nível" (ex.: "Arrow Storm==10"). Veja list_skills.'),
    skills: z
      .object({
        active: stringMap(z.number()).optional(),
        passive: stringMap(z.number()).optional(),
        buffs: stringMap(z.number()).optional(),
      })
      .optional()
      .describe('Níveis por NOME da habilidade (nunca por posição).'),

    options: stringMap(z.string().nullable()).optional().describe('Bônus aleatórios por número de slot, no formato "attr:valor".'),
    consumables: z.array(z.number().int()).optional(),
    aspdPotion: z.number().int().optional(),
    propertyAtk: z.string().optional().describe('Elemento do ataque (conversor/endow).'),
    rotation: z
      .array(z.string())
      .max(30)
      .optional()
      .describe('Rotação de habilidades, cada passo "Nome==Nível" (ou o ataque básico). Alimenta a métrica rotationDps; sem isso vale a rotação do link, se houver.'),
};

export const buildInputSchema = strictShape(buildShape, 'build')
  .describe('Build a calcular. Sem `share`/`preset`, parte de uma build vazia com os overrides aplicados.');

export type BuildInput = z.infer<typeof buildInputSchema>;

/**
 * The build argument as every tool but `calculate` advertises it. The full schema is about 3.6 KB and was repeated in each
 * tool, roughly half of everything `tools/list` sends; here the argument is declared as just `share` plus whatever overrides
 * `calculate.build` documents, and validated against the full schema on the way in (`pipe`), so the handlers still receive a
 * checked `BuildInput` and a wrong field still fails with the readable error.
 */
export const compactBuildSchema = z
  .looseObject({
    share: z.string().optional().describe('Link do simulador (URL completa, encurtada, fragmento antigo #/?b=… ou token). Base da build.'),
  })
  .describe('Build: share com overrides esparsos; aceita os campos de calculate.build, incluindo personalizados e customAttachments.')
  .pipe(buildInputSchema);

export interface ResolvedBuild {
  model: MainModel & Record<string, any>;
  char: CharacterBase;
  classInfo: ClassInfo | undefined;
  /** Non-fatal problems worth telling the agent about (unknown item ids, etc.). */
  warnings: string[];
  /** Level, job level and stats the class limits changed silently (what was asked, and what the calculation used). */
  adjusted: { field: string; from: number; to: number }[];
  items: Record<number, ItemModel>;
  customItems: CustomItemDefinition[];
}

/** Apply the sparse overrides onto a model produced by `applyPreset`. */
function applyOverrides(model: any, input: BuildInput, warnings: string[], dataset: Dataset, items: Record<number, ItemModel>): void {
  if (input.class !== undefined) model.class = input.class;
  if (input.level !== undefined) model.level = input.level;
  if (input.jobLevel !== undefined) model.jobLevel = input.jobLevel;
  if (input.propertyAtk !== undefined) model.propertyAtk = input.propertyAtk;
  if (input.atkSkill !== undefined) model.selectedAtkSkill = input.atkSkill;
  if (input.aspdPotion !== undefined) model.aspdPotion = input.aspdPotion;
  if (input.consumables) model.consumables = [...input.consumables];
  if (input.rotation) model.rotation = [...input.rotation];
  if (input.customAttachments) model.customAttachments = { ...model.customAttachments, ...structuredClone(input.customAttachments) };

  for (const [stat, value] of Object.entries(input.stats ?? {})) {
    if (value !== undefined) model[stat] = value;
  }

  for (const [slot, value] of Object.entries(input.gear ?? {})) {
    if (!MODEL_KEYS.has(slot)) {
      warnings.push(`Slot desconhecido "${slot}" ignorado.`);
      continue;
    }
    model[slot] = value === null ? 0 : value;
  }

  for (const [slot, txt] of Object.entries(input.options ?? {})) {
    const index = Number(slot);
    if (!Number.isInteger(index) || index < 0) {
      warnings.push(`Slot de bônus aleatório inválido "${slot}" ignorado.`);
      continue;
    }
    model.rawOptionTxts[index] = txt;
  }

  // Skill overrides go through the name-keyed maps, which applySkillMaps then turns
  // into the positional arrays the engine reads.
  if (input.skills?.active) model.activeSkillMap = { ...model.activeSkillMap, ...input.skills.active };
  if (input.skills?.passive) model.passiveSkillMap = { ...model.passiveSkillMap, ...input.skills.passive };
  if (input.skills?.buffs) model.skillBuffMap = { ...model.skillBuffMap, ...input.skills.buffs };

  // An id the calculator has no record for is silently ignored by loadItemFromModel,
  // and ~6,6k LATAM items legitimately fall in that bucket — so say so out loud.
  for (const key of ITEM_ID_KEYS) {
    const id = model[key];
    if (typeof id !== 'number' || id <= 0 || items[id]) continue;
    const latamName = dataset.latamExtra[id]?.name;
    warnings.push(
      latamName
        ? `Item ${id} ("${latamName}") existe no LATAM mas ainda não está no banco do calculador — ignorado em ${key}.`
        : `Item ${id} desconhecido — ignorado em ${key}.`,
    );
  }
}

/**
 * share/preset → MainModel → derived state → a fresh class instance, ready to solve.
 * Mirrors `loadItemSet`'s ordering: clamp, then job bonus, then skills, then skill choice.
 */
export function resolveBuild(input: BuildInput, dataset: Dataset): ResolvedBuild {
  const warnings: string[] = [];

  let base: Record<string, any> | null = null;
  let embedded: CustomItemDefinition[] = [];
  if (input.share) {
    const share = parseShare(input.share);
    base = share.preset;
    embedded = share.items ?? [];
  } else if (input.preset) {
    base = input.preset as Record<string, any>;
  }

  const validation = validateCustomItems([...embedded, ...(input.customItems ?? [])], dataset.items);
  if (validation.errors.length && (embedded.length || input.customItems?.length)) {
    throw new Error(validation.errors.map((e) => `${e.path}: ${e.message}`).join('; '));
  }
  const customItems = validation.items;
  // Spreading the whole item table costs ~5 ms and a few MB of garbage per build; only a build that
  // carries custom items needs its own copy. The dataset is shared read-only, so reuse it otherwise.
  const items: Record<number, ItemModel> = customItems.length
    ? { ...dataset.items, ...Object.fromEntries(customItems.map((item) => [item.id, item])) }
    : dataset.items;
  const model = applyPreset(base) as any;
  applyOverrides(model, input, warnings, dataset, items);
  for (const [slot, descriptor] of SLOTS_BY_KEY) {
    const item = items[model[slot]];
    if (!item) continue;
    const refine = Number(model[`${slot}Refine`] ?? 0);
    const cap = refineLimitFor(slot, item);
    if (refine > cap) {
      if (input.gear?.[`${slot}Refine`] !== undefined) throw new Error(`${slot}: refino máximo +${cap}.`);
      warnings.push(`${slot}: refino +${refine} excede o máximo +${cap}; cálculo limitado ao máximo.`);
      model[`${slot}Refine`] = cap;
    }
    const error = enchantCombinationError(item, descriptor.enchantFields.map(field => field ? items[model[field]] : undefined));
    if (error) throw new Error(`${slot}: ${error}`);
    const pools = enchantPoolsFor(item);
    descriptor.enchantFields.forEach((field, position) => {
      if (!field || !input.gear?.[field] || !pools) return;
      const enchant = items[model[field]];
      if (!pools[position]?.includes(enchant?.aegisName)) throw new Error(`${slot}: ${enchant?.name ?? model[field]} não é permitido na posição ${position} deste equipamento.`);
    });
  }

  if (!dataset.classes.has(model.class)) {
    throw new Error(`Classe ${model.class} não existe ou não está disponível no LATAM. Use list_classes para ver as opções.`);
  }
  const char = dataset.classes.newInstance(model.class);

  const limited = ['level', 'jobLevel', ...STAT_KEYS] as const;
  const before = Object.fromEntries(limited.map((field) => [field, model[field]]));
  clampLevels(model, char);
  const adjusted = limited.filter((field) => typeof before[field] === 'number' && model[field] !== before[field])
    .map((field) => ({ field, from: before[field] as number, to: model[field] as number }));
  for (const { field, from, to } of adjusted) warnings.push(`${field}: ${from} está fora do limite da classe; o cálculo usou ${to}.`);
  applyJobBonus(model, char);
  applySkillMaps(model, char);
  const skillIssue = resolveAtkSkill(model, char);
  if (skillIssue) {
    const message = `Habilidade "${skillIssue.unresolved}" não existe nesta classe ou o nível não existe (a calculadora usaria ${skillIssue.usedInstead}). Use list_skills para os nomes e níveis.`;
    // Asked for by the caller: refuse, so a number is never reported for a skill that was not the one requested. From an old link it
    // still falls back to the class default, with the warning.
    if (input.atkSkill !== undefined) throw new Error(message);
    warnings.push(message);
  }
  model.rawOptionTxts = toRawOptionTxtList(model, items);
  if (input.options) {
    for (const [slot, positions] of ItemOptionMap) {
      const error = validateCataloguedRolls(Number(model[slot]), positions.map(index => model.rawOptionTxts[index]));
      if (error) throw new Error(error);
    }
  }

  return { model: model as ResolvedBuild['model'], char, classInfo: dataset.classes.get(model.class), warnings, adjusted, items, customItems };
}
