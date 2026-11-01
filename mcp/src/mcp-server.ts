import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Dataset } from './data/dataset';
import { registerDiscoveryTools } from './tools/discovery';
import { registerBridgeTools, registerCalculationTools } from './tools/calculate';
import { registerCustomItemTools } from './tools/custom-items';
import { registerOptimizationTools } from './tools/optimize';
import { registerStatTools } from './tools/optimize-stats';
import { registerRandomPoolTools } from './tools/random-pools';
import { Shortener } from './engine/share';
import { useShortener } from './tools/helpers';
import { APP_VERSION } from 'src/app/core/app-version';

/**
 * Keeps AJV out of the request path.
 *
 * The SDK constructs `new AjvJsonSchemaValidator()` per `McpServer` — which here means per
 * request — and that constructor builds an Ajv instance and registers its formats, even
 * though the only thing that ever calls the validator is elicitation's `requestedSchema`.
 * We register no `outputSchema` and never elicit, so passing one explicitly skips that work
 * on every POST.
 *
 * It does NOT shrink the bundle: the SDK's import of the provider is static and referenced,
 * so esbuild keeps Ajv either way. Workers would refuse to run its codegen (`new Function`
 * is blocked), which is another reason never to reach it.
 *
 * It throws rather than returning `valid` so that adding an `outputSchema` later fails
 * loudly here instead of silently skipping validation.
 */
const unreachableValidator = {
  getValidator() {
    throw new Error(
      'Validação de JSON Schema não está disponível: nenhuma ferramenta declara outputSchema ' +
        'e elicitation não é usada. Se isso mudou, registre um validador compatível com Workers ' +
        '(@modelcontextprotocol/sdk/validation/cfworker).',
    );
  },
};

/**
 * A fresh McpServer per request. Registration is microseconds — the expensive state
 * (the dataset and its indexes) is shared read-only and never rebuilt.
 */
export function createMcpServer(dataset: Dataset, shortener?: Shortener): McpServer {
  const server = new McpServer(
    { name: 'ro-calc-latam', version: APP_VERSION },
    {
      jsonSchemaValidator: unreachableValidator as any,
      instructions:
        'Simulador de dano de Ragnarok Online LATAM. Fluxo típico: list_classes → list_skills → search_items → calculate. ' +
        'Toda ferramenta que recebe uma build aceita um link do simulador em `build.share`, com overrides esparsos por cima — ' +
        'então, se a pessoa colar um link, use-o direto em vez de remontar a build. ' +
        'Devolva sempre o `share` do resultado para que ela possa abrir e conferir no simulador. ' +
        'Ao sugerir melhorias, penetração de DEF/TEN e penalidade de tamanho do alvo contam tanto quanto ATQ: confira `context` (tamanho do alvo, penalidade da arma, penetração atual) e, se a pessoa caça monstros de portes diferentes, passe `targets` com um Médio e um Grande. ' +
        'Para procurar melhorias: `explain_damage` mostra onde está o dano e o que o número não conta, `slot_options` lista os encantamentos que uma peça aceita, ' +
        '`evaluate_variants` testa dezenas de variações de uma vez, em vez de uma chamada por teste; `optimize_stats` redistribui os pontos de atributo e ' +
        '`uncatalogued_pools` lista os itens cujo pool de bônus aleatório ainda não foi confirmado.',
    },
  );

  useShortener(server, shortener);
  registerDiscoveryTools(server, dataset);
  registerCalculationTools(server, dataset, shortener);
  registerBridgeTools(server, dataset, shortener);
  registerCustomItemTools(server, dataset, shortener);
  registerOptimizationTools(server, dataset, shortener);
  registerRandomPoolTools(server, dataset);
  registerStatTools(server, dataset, shortener);

  return server;
}
