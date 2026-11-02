/**
 * `validate_build`: is this build one the game accepts, and one the calculator can measure? It reports, it does not repair or
 * rank. Everything it states comes from the same rules the engine and the optimizer use (class and level of the item, the slots
 * a piece or card accepts, the enchant pools, the refine cap); what it cannot check it lists under `unknowns` instead of passing.
 */
import { EQUIPMENT_SLOTS } from 'src/app/app-config/equipment-slots';
import { MVP_CARD_IDS } from 'src/app/constants/mvp-cards';
import { APP_VERSION } from 'src/app/core/app-version';
import { canUsedByClass } from 'src/app/utils';
import { Dataset } from '../data/dataset';
import { BuildInput, resolveBuild } from './build-input';

export interface BuildIssue { code: string; path: string; message: string; itemId?: number }

export interface ValidateConstraints {
  /** A card dropped by an MVP is an error. The classification is by card (`MVP_CARD_IDS`), never by the target. */
  excludeMvpCards?: boolean;
  /** Items LATAM has not shipped are errors (default true: this server is LATAM). */
  latamOnly?: boolean;
  /** Items the calculator has no mechanical data for are errors instead of warnings (default true). */
  requireCalculableItems?: boolean;
}

export function validateBuild(input: BuildInput, dataset: Dataset, constraints: ValidateConstraints = {}) {
  const { excludeMvpCards = false, latamOnly = true, requireCalculableItems = true } = constraints;
  const errors: BuildIssue[] = [];
  const warnings: BuildIssue[] = [];
  const unknowns: string[] = [
    'Pontos de atributo e de habilidade e pré-requisitos de habilidade não são validados.',
    'Classificação de carta de MVP vem do nome da carta (não há tabela de drops no LATAM): carta em dúvida está na lista.',
  ];
  // The data artifacts are built and shipped with the app, so they carry its version.
  const base = { engineVersion: APP_VERSION, dataVersion: APP_VERSION };

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
  const usable = canUsedByClass(char);

  for (const descriptor of EQUIPMENT_SLOTS) {
    const slotId = model[descriptor.key];
    const fields = [
      ...(typeof slotId === 'number' && slotId > 0 ? [{ field: descriptor.key as string, kind: 'piece' as const }] : []),
      ...descriptor.cardFields.map((field) => ({ field: field as string, kind: 'card' as const })),
      ...descriptor.enchantFields.filter((field): field is NonNullable<typeof field> => !!field).map((field) => ({ field: field as string, kind: 'enchant' as const })),
    ];
    for (const { field, kind } of fields) {
      const id = model[field];
      if (typeof id !== 'number' || id <= 0) continue;
      const path = `gear.${field}`;
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
        const position = descriptor.cardFields.indexOf(field as never);
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
      if (kind === 'piece' && (!record.script || Object.keys(record.script).length === 0) && !record.attack && !record.defense) {
        warnings.push({ code: 'UNSUPPORTED_EFFECT', path, itemId: id, message: `${row.name} não tem bônus no calculador (conferir o texto do item).` });
      }
    }
  }

  for (const message of resolved.warnings) warnings.push({ code: 'ENGINE_WARNING', path: 'build', message });

  return { valid: errors.length === 0, errors, warnings, unknowns, ...base };
}
