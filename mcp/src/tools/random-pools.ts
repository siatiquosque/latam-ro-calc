/** The queue of items whose random-bonus pool is still unknown, and the way out of it. */
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomOptionCatalogFor } from 'src/app/core/random-option-catalog';
import { Dataset } from '../data/dataset';
import { auditedRandomItems, draftPoolFor } from '../data/random-options';
import { json, registerJsonTool } from './helpers';

export function registerRandomPoolTools(server: McpServer, dataset: Dataset): void {
  registerJsonTool<{ query?: string; slot?: string; policy?: 'explicit-table' | 'all'; itemId?: number; limit?: number; offset?: number }>(server, 'uncatalogued_pools', {
    title: 'Itens sem pool de bônus aleatório',
    description:
      'Lista os itens LATAM que rolam bônus aleatórios e ainda não têm pool confirmado (por isso ficam fora da busca de rolagens do `optimize_build`). ' +
      'Com `itemId`, devolve um rascunho de pool montado a partir do rAthena, no formato de `data/random-options/regional-pools.json`: ' +
      'confira no jogo e só então copie para o arquivo — o rascunho NÃO é confirmação para o LATAM. ' +
      '`policy` padrão `explicit-table` (itens que realmente rolam); `all` inclui armas e sombrios genéricos.',
    inputSchema: {
      query: z.string().optional().describe('Filtra pelo nome.'),
      slot: z.string().optional().describe('Filtra pelo slot (ex.: accLeft, shadowWeapon).'),
      policy: z.enum(['explicit-table', 'all']).optional().default('explicit-table'),
      itemId: z.number().int().optional().describe('Devolve o rascunho de pool deste item.'),
      limit: z.number().int().min(1).max(100).optional().default(30),
      offset: z.number().int().min(0).optional().default(0),
    },
  }, async ({ query, slot, policy = 'explicit-table', itemId, limit = 30, offset = 0 }) => {
    if (itemId !== undefined) {
      const item = dataset.items[itemId];
      if (!item) throw new Error(`Item ${itemId} não está no banco do calculador.`);
      if (randomOptionCatalogFor(itemId)) return json({ id: itemId, name: item.name, catalogued: true });
      const draft = draftPoolFor(itemId);
      return json({
        id: itemId, name: item.name, catalogued: false,
        ...(draft ?? { note: 'O rAthena não tem pool para este item; nada a rascunhar.' }),
        ...(draft ? { howTo: `Confirme no jogo e acrescente "${itemId}": <pool> em data/random-options/regional-pools.json (docs/random-options-audit.md).` } : {}),
      });
    }
    const needle = (query ?? '').trim().toLowerCase();
    const rows = auditedRandomItems()
      .filter(row => (policy === 'all' || row.policy === 'explicit-table') && !randomOptionCatalogFor(row.id))
      .filter(row => dataset.itemIndex.get(row.id)?.latam === true)
      .filter(row => !slot || dataset.itemIndex.get(row.id)?.slotTags.includes(slot as never))
      .map(row => ({ ...row, name: dataset.itemIndex.get(row.id)?.name ?? row.name }))
      .filter(row => !needle || row.name.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.groups.length > 0) - Number(a.groups.length > 0) || a.id - b.id);
    const page = rows.slice(offset, offset + limit);
    return json({
      total: rows.length, shown: page.length, offset,
      items: page.map(row => ({ id: row.id, name: row.name, capacity: row.capacity, hasUpstreamPool: row.groups.length > 0, groups: row.groups })),
      ...(rows.length > offset + page.length ? { hint: `Mais ${rows.length - offset - page.length}: use offset=${offset + page.length}.` } : {}),
    });
  });
}
