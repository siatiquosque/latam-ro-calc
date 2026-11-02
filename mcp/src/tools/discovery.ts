/**
 * Discovery tools: what classes, items, monsters, skills and bonus keys exist.
 * All read-only and cheap — no solve.
 *
 * Schemas and static payloads live at module scope, not inside the register calls:
 * a fresh McpServer is built per HTTP POST, so anything constructed in there is
 * rebuilt on every request.
 */
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { bonusKeyLabel, decodeStructuredBonusKey } from 'src/app/core/bonus-key-label';
import { createBonusNameList } from 'src/app/utils';
import { resolveSkillMeta } from 'src/app/skills';
import { elementPtBr } from 'src/app/constants/monster-i18n';
import { itemAutoCastScripts, itemBonusScriptEntries } from 'src/app/models/item.model';
import { config } from '../config';
import { Dataset } from '../data/dataset';
import { ItemRow, SearchFilters } from '../data/item-index';
import { MonsterRow } from '../data/monster-index';
import { SLOT_TAGS } from '../data/slot-classifier';
import { plainItemDesc } from '../data/text';
import { compact, json, paged, registerJsonTool } from './helpers';
import { findSkill, skillInfo } from 'src/app/build-analysis/engine/skill-info';
import { skillSynergyKeys } from 'src/app/core/skill-synergy';
import { MVP_CARD_IDS } from 'src/app/constants/mvp-cards';
import { partnerIndex } from 'src/app/build-analysis/engine/item-partners';
import { SKILL_ID_BY_NAME } from 'src/app/skills';

const slotEnum = z.enum(SLOT_TAGS);

/**
 * Factories rather than consts: this module is evaluated by the dynamic `import()` in the
 * Worker, which runs before `initConfig`, so a const would capture the default limit and
 * a MAX_SEARCH_RESULTS var would silently do nothing.
 */
const searchItemsSchema = () => ({
  query: z.string().optional().describe('Texto livre; acentos são ignorados ("pocao magica" acha "Poção Mágica").'),
  slot: slotEnum.optional(),
  classId: z.number().int().optional().describe('Só itens equipáveis por esta classe.'),
  bonus: z.array(z.string()).optional().describe('Chaves de bônus (veja list_bonus_keys).'),
  bonusMode: z.enum(['all', 'any']).optional().default('all'),
  skill: z.string().optional().describe('Id da habilidade: acha bônus de dano, recarga e conjuração dela.'),
  synergy: z.boolean().optional().describe('Com skill e classId: inclui dependências indiretas documentadas (HP/HP%/VIT para Fogueira). Filtre equipamentos, cartas ou encantamentos por slot.'),
  minSlots: z.number().int().optional(),
  maxLevel: z.number().int().optional().describe('Nível necessário no máximo N.'),
  inCalcDb: z.boolean().optional().describe('true = só itens do calculador; false = só os que faltam cadastrar.'),
  latamOnly: z.boolean().optional().default(true),
  withBonuses: z.boolean().optional().describe('Cada linha traz `bonuses`: até 6 bônus do item em texto curto (rótulo e valor), para ler os candidatos sem chamar get_item em cada um.'),
  excludeMvpCards: z.boolean().optional().describe('Não devolve cartas que caem de MVP (a classificação é pela carta, não pelo alvo).'),
  limit: z.number().int().min(1).max(config.limits.maxSearchResults).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
});

const searchMonstersSchema = () => ({
  query: z.string().optional(),
  minLevel: z.number().int().optional(),
  maxLevel: z.number().int().optional(),
  race: z.string().optional().describe('Chave em inglês: Formless, Undead, Brute, Plant, Insect, Fish, Demon, DemiHuman, Angel, Dragon.'),
  element: z.string().optional().describe('Chave em inglês: Neutral, Water, Earth, Fire, Wind, Poison, Holy, Dark, Ghost, Undead.'),
  size: z.string().optional().describe('Small, Medium ou Large.'),
  boss: z.boolean().optional(),
  hasStats: z.boolean().optional().default(true),
  limit: z.number().int().min(1).max(config.limits.maxSearchResults).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
});

const idSchema = { id: z.number().int() };

/** Compact row: ~25-35 tokens. Full records only ever come from get_item. */
const toItemRow = (r: ItemRow) =>
  compact({
    id: r.id,
    name: r.name,
    slots: r.slots,
    db: r.inCalcDb,
    ...(r.inCalcDb
      ? { slot: r.slotTags?.[0], lv: r.reqLv || undefined, atk: r.atk || undefined, def: r.def || undefined }
      : { note: 'sem dados no calculador' }),
  });

const toMonsterRow = (index: Dataset['monsterIndex']) => (m: MonsterRow) =>
  compact({
    id: m.id,
    name: m.name,
    level: m.level,
    hp: m.hp,
    ...index.labels(m, m.element),
    mvp: m.mvp,
    hasStats: m.hasStats ? undefined : false,
  });

/** Static for the process lifetime — the bonus tree has no dataset dependency. */
let flatBonusKeys: { key: string; label: string }[] | undefined;
function bonusKeys(): { key: string; label: string }[] {
  if (flatBonusKeys) return flatBonusKeys;
  const flat: { key: string; label: string }[] = [];
  const walk = (nodes: any[]) => {
    for (const node of nodes ?? []) {
      if (node.children?.length) walk(node.children);
      else if (node.value) flat.push({ key: String(node.value), label: node.label ?? bonusKeyLabel(String(node.value)) });
    }
  };
  walk(createBonusNameList() as any[]);
  flatBonusKeys = flat;
  return flat;
}

export function registerDiscoveryTools(server: McpServer, dataset: Dataset): void {
  registerJsonTool<{ classId: number; skill: string; level?: number; formulaVersion?: 'current' | 'pre-rebalance' | 'rebalance-2026-02' }>(server, 'get_skill', {
    title: 'Descrição e mecânicas da habilidade',
    description: 'Consulta descrição, tempos, crítico e dependências observadas nos callbacks da habilidade. Aceita nome, value ou id. Use search_items/find_synergies para investigar e evaluate_variants para confirmar estados concretos.',
    inputSchema: { classId: z.number().int(), skill: z.string(), level: z.number().int().min(1).optional(), formulaVersion: z.enum(['current', 'pre-rebalance', 'rebalance-2026-02']).optional() },
  }, ({ classId, skill, level, formulaVersion }) => json(skillInfo(dataset.classes.newInstance(classId), skill, formulaVersion, level)));
  registerJsonTool(server, 'list_classes', {
    title: 'Listar classes',
    description: 'Lista as classes jogáveis no RO LATAM, com id interno, nome pt-BR e limites de nível. O id é o que as outras ferramentas esperam em `build.class`.',
    inputSchema: {},
  }, () => json({ classes: dataset.classes.list() }));

  registerJsonTool<SearchFilters>(server, 'search_items', {
    title: 'Buscar itens',
    description:
      'Busca itens por nome (sem distinção de acentos) e/ou por filtros estruturais. Cobre TANTO o banco do calculador quanto o banco completo do LATAM: itens marcados com `db: false` existem no jogo mas ainda não foram cadastrados no calculador, então aparecem só com nome/descrição e não podem ser usados em builds. Qualquer filtro estrutural (slot, classId, bonus, skill, minSlots, maxLevel) implica `db: true`, porque esses itens não têm dados mecânicos. `excludeMvpCards` tira cartas que caem de MVP; `withBonuses` traz o que cada item faz, em texto curto.',
    inputSchema: searchItemsSchema(),
  }, (filters) => {
    const char = filters.classId !== undefined ? dataset.classes.newInstance(filters.classId) : undefined;
    let search = filters;
    if (filters.synergy) {
      if (!char || !filters.skill) throw new Error('synergy requer classId e skill. Veja get_skill.');
      const skill = findSkill(char, filters.skill);
      const id = SKILL_ID_BY_NAME[skill.name];
      search = { ...filters, skill: undefined, bonusMode: 'any', bonus: [...new Set([...(filters.bonus ?? []), ...skillSynergyKeys(skill), String(id), `cd__${id}`, `vct__${id}`, `fct__${id}`])] };
    }
    const { total, rows } = dataset.itemIndex.search(search, char);
    const bonusesOf = (id: number): string[] | undefined => {
      if (!filters.withBonuses) return undefined;
      const script = dataset.itemIndex.record(id)?.script;
      if (!script) return undefined;
      return itemBonusScriptEntries(script).slice(0, 6).map(([key, values]) => `${bonusKeyLabel(key)}: ${[].concat(values as never).slice(0, 2).join(' / ')}`);
    };
    return json(paged('items', total, rows, filters.offset ?? 0, (row) => compact({ ...toItemRow(row), bonuses: bonusesOf(row.id) })));
  });

  registerJsonTool<{ id: number }>(server, 'get_item', {
    title: 'Detalhes do item',
    description: 'Ficha completa de um item: descrição pt-BR, campos estruturais, classes que podem usar e os bônus decodificados. Itens fora do banco do calculador voltam só com nome e descrição.',
    inputSchema: idSchema,
  }, async ({ id }) => {
    const row = dataset.itemIndex.get(id);
    if (!row) return json({ error: `Item ${id} não encontrado nem no calculador nem no banco do LATAM.` }, true);

    // items-core carries no description at all — it is a separate artifact, fetched on
    // first use, so that a session which only calculates never downloads 7 MB of prose.
    const description = plainItemDesc(await dataset.description(id));
    if (!row.inCalcDb) {
      return json({
        id,
        name: row.name,
        inCalcDb: false,
        description,
        note: 'Existe no LATAM mas ainda não foi cadastrado no calculador — não pode ser usado em builds.',
      });
    }

    const rec = dataset.itemIndex.record(id)!;
    return json(
      compact({
        id,
        name: rec.name,
        enName: rec.enName,
        aegisName: rec.aegisName,
        inCalcDb: true,
        mvpCard: MVP_CARD_IDS.has(id) || undefined,
        // Pieces the scripts name as set or combo partners: they pay only together, so test them as one (evaluate_variants).
        partners: partnerIndex(dataset).of(id).slice(0, 12).map((partner) => ({ id: partner, name: dataset.itemIndex.get(partner)?.name, slot: partnerIndex(dataset).slotOf(partner) })),
        presentInLatam: !!rec.presentInLatam,
        slots: rec.slots || 0,
        slotTags: row.slotTags ?? [],
        requiredLevel: rec.requiredLevel ?? undefined,
        weaponLevel: rec.itemLevel ?? undefined,
        attack: rec.attack ?? undefined,
        defense: rec.defense ?? undefined,
        usableClass: rec.usableClass,
        unusableClass: rec.unusableClass,
        description,
        autoCasts: itemAutoCastScripts(rec.script),
        bonuses: itemBonusScriptEntries(rec.script).map(([key, values]) => ({
          key,
          label: bonusKeyLabel(key),
          structured: decodeStructuredBonusKey(key) ?? undefined,
          values,
        })),
      }),
    );
  });

  registerJsonTool<Record<string, any>>(server, 'search_monsters', {
    title: 'Buscar monstros',
    description:
      'Busca monstros por nome (ou id) e atributos. Por padrão devolve só os que têm bloco de atributos no calculador, que são os únicos utilizáveis como alvo em `calculate`.',
    inputSchema: searchMonstersSchema(),
  }, (args) => {
    const { total, rows } = dataset.monsterIndex.search(args);
    return json(paged('monsters', total, rows, args['offset'] ?? 0, toMonsterRow(dataset.monsterIndex)));
  });

  registerJsonTool<{ id: number }>(server, 'get_monster', {
    title: 'Detalhes do monstro',
    description: 'Bloco de atributos completo de um monstro.',
    inputSchema: idSchema,
  }, ({ id }) => {
    const detail = dataset.monsterIndex.detail(id);
    return detail ? json(detail) : json({ error: `Monstro ${id} não encontrado.` }, true);
  });

  registerJsonTool<{ classId: number; kind?: 'atk' | 'active' | 'passive' }>(server, 'list_skills', {
    title: 'Listar habilidades da classe',
    description:
      'Habilidades de uma classe. Para `kind: "atk"`, o campo `value` é exatamente o que `build.atkSkill` espera ("Nome==Nível"). Os multiplicadores das habilidades são funções do motor, não dados — para saber o dano de uma delas, chame `calculate`.',
    inputSchema: {
      classId: z.number().int(),
      kind: z.enum(['atk', 'active', 'passive']).optional().default('atk'),
    },
  }, ({ classId, kind }) => {
    if (!dataset.classes.has(classId)) return json({ error: `Classe ${classId} não disponível. Veja list_classes.` }, true);
    const char = dataset.classes.newInstance(classId);

    if (kind === 'atk') {
      return json({
        classId,
        skills: char.atkSkills.map((s: any) => {
          const meta = resolveSkillMeta(s.name);
          return compact({
            value: s.value,
            name: s.name,
            label: meta?.label ?? s.label ?? s.name,
            id: meta?.id,
            // Entrada de rotação sem dano (Esconderijo, Infiltrar): ocupa uma ação do ciclo
            // e nunca pontua, então não serve para `calculate` sozinha.
            utility: s.isUtility || undefined,
            element: s.element ? elementPtBr(s.element) : undefined,
            magic: s.isMatk || undefined,
            hits: s.hit || undefined,
            levels: s.levelList?.length ? s.levelList.map((lv: any) => lv.value) : undefined,
          });
        }),
      });
    }

    const list = kind === 'active' ? char.activeSkills : char.passiveSkills;
    return json({
      classId,
      skills: (list as any[]).map((s) => ({
        name: s.name,
        label: resolveSkillMeta(s.name)?.label ?? s.label ?? s.name,
        maxLevel: Math.max(0, ...s.dropdown.map((d: any) => Number(d.value) || 0)),
      })),
    });
  });

  registerJsonTool<{ query?: string }>(server, 'list_bonus_keys', {
    title: 'Listar chaves de bônus',
    description: 'Todas as chaves de bônus pesquisáveis, com rótulo pt-BR. Use-as no filtro `bonus` de search_items.',
    inputSchema: { query: z.string().optional().describe('Filtra por texto no rótulo ou na chave.') },
  }, ({ query }) => {
    const all = bonusKeys();
    const q = query?.toLowerCase();
    const rows = q ? all.filter((b) => b.key.toLowerCase().includes(q) || b.label.toLowerCase().includes(q)) : all;
    return json({ total: rows.length, keys: rows });
  });
}
