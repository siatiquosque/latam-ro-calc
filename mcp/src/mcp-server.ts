import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Dataset } from './data/dataset';
import { registerDiscoveryTools } from './tools/discovery';
import { registerBridgeTools, registerCalculationTools } from './tools/calculate';
import { registerCustomItemTools } from './tools/custom-items';
import { registerOptimizationTools } from './tools/optimize';
import { registerStatTools } from './tools/optimize-stats';
import { registerGuideTool } from './tools/guide';
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
        'Simulador de dano de Ragnarok Online LATAM. Toda ferramenta que recebe uma build aceita o link do simulador em `build.share`, com overrides esparsos ' +
        'por cima: se a pessoa colar um link, use-o direto. Devolva sempre o `share` do resultado. Fluxo: list_classes → list_skills → search_items → calculate. ' +
        'Para melhorar uma build: `optimize_build` (build inteira), `scan_slot` (achar a peça improvável de um slot), `optimize_slot`, `evaluate_variants`, ' +
        '`explain_damage`, `optimize_stats`. Três cuidados: o alvo padrão (Dummy - Neutro) não tem defesa, então prefira um chefe real ou os dummies 9000001 a 9000004; ' +
        'passe `targets` com normal e chefe (e Médio e Grande) quando a build serve a mais de um; e não use `max` como objetivo (ignora crítico). ' +
        'Em dúvida sobre qual ferramenta usar, o alvo, burst contra DPS sustentado, proc contra peça estável ou como ler a resposta, chame `guide`.',
    },
  );

  useShortener(server, shortener);
  registerGuideTool(server);
  registerDiscoveryTools(server, dataset);
  registerCalculationTools(server, dataset, shortener);
  registerBridgeTools(server, dataset, shortener);
  registerCustomItemTools(server, dataset, shortener);
  registerOptimizationTools(server, dataset, shortener);
  registerRandomPoolTools(server, dataset);
  registerStatTools(server, dataset, shortener);

  return server;
}
