/** The queue of items whose random-bonus pool no regional source confirms, and the way out of it. */
const confirmed = (itemId: number) => ['code', 'regional', 'wiki'].includes(randomPoolTier(itemId) ?? '');

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomPoolTier } from 'src/app/core/random-option-catalog';
import { Dataset } from '../data/dataset';
import { auditedRandomItems, draftPoolFor } from '../data/random-options';
import { json, registerJsonTool } from './helpers';

export function registerRandomPoolTools(server: McpServer, dataset: Dataset): void {
  registerJsonTool<{ query?: string; slot?: string; policy?: 'explicit-table' | 'all'; itemId?: number; limit?: number; offset?: number }>(server, 'uncatalogued_pools', {
    title: 'Itens com pool de bônus aleatório não confirmado',
    description:
      'Lista os itens LATAM que rolam bônus aleatórios e nenhuma fonte regional (código, regional-pools.json, bROWiki) confirma. ' +
      '`pool: "rathena"` = usam o pool do kRO como substituto (o LATAM tende a seguir o kRO, sem confirmação); `pool: "nenhum"` = ficam abertos e fora da busca de rolagens. ' +
      'Com `itemId`, devolve o pool do rAthena como rascunho de `profiles` para `tools/add-regional-pool.py` (grava em `data/random-options/regional-pools.json`): ' +
      'confira no jogo e só então copie para o arquivo, o que o torna confirmado. ' +
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
      if (confirmed(itemId)) return json({ id: itemId, name: item.name, catalogued: true });
      const draft = draftPoolFor(itemId);
      return json({
        id: itemId, name: item.name, catalogued: false,
        ...(draft ?? { note: 'O rAthena não tem pool para este item; nada a rascunhar.' }),
        ...(draft ? { howTo: `Confirme no jogo e grave os profiles em um arquivo e rode python tools/add-regional-pool.py ${itemId} <arquivo> --source ... --confidence ... (docs/random-options-audit.md).` } : {}),
      });
    }
    const needle = (query ?? '').trim().toLowerCase();
    const rows = auditedRandomItems()
      .filter(row => (policy === 'all' || row.policy === 'explicit-table') && !confirmed(row.id))
      .filter(row => dataset.itemIndex.get(row.id)?.latam === true)
      .filter(row => !slot || dataset.itemIndex.get(row.id)?.slotTags.includes(slot as never))
      .map(row => ({ ...row, name: dataset.itemIndex.get(row.id)?.name ?? row.name }))
      .filter(row => !needle || row.name.toLowerCase().includes(needle))
      .sort((a, b) => Number(randomPoolTier(b.id) === 'rathena') - Number(randomPoolTier(a.id) === 'rathena') || a.id - b.id);
    const page = rows.slice(offset, offset + limit);
    return json({
      total: rows.length, shown: page.length, offset,
      items: page.map(row => ({ id: row.id, name: row.name, capacity: row.capacity, pool: randomPoolTier(row.id) ?? 'nenhum', groups: row.groups })),
      ...(rows.length > offset + page.length ? { hint: `Mais ${rows.length - offset - page.length}: use offset=${offset + page.length}.` } : {}),
    });
  });
}
