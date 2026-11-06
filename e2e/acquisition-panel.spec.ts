import { expect, Page, test } from '@playwright/test';
import fixture from '../mcp/src/engine/__tests__/fixtures/inquisitor-optimization.json';
import briefs from './fixtures/acquisition-briefs.json';

declare global { interface Window { __modes: string[]; __stub?: unknown } }

test.beforeEach(async ({ page }) => {
  await page.addInitScript(preset => {
    localStorage.setItem('ro-set', JSON.stringify(preset));
    localStorage.setItem('monster', '21077');
    localStorage.setItem('ro-right-accordion-active', '[]');
    // Records every request sent to an analysis worker; `window.__stub` answers `acquisition` requests with a canned brief.
    window.__modes = [];
    const Real = window.Worker;
    window.Worker = class extends Real {
      override postMessage(message: any, ...rest: any[]) {
        window.__modes.push(message?.mode);
        if (message?.mode === 'acquisition' && window.__stub) { queueMicrotask(() => (this as any).onmessage?.({ data: { result: window.__stub } })); return; }
        (super.postMessage as any)(message, ...rest);
      }
    };
  }, fixture.preset);
  await page.route('**/mcp', route => route.abort('failed'));
});

/** Restricted weapon search, as in build-improvements.spec: quick, and it always proposes a change. */
async function search(page: Page) {
  await page.goto('/');
  await expect(page.locator('#ro-splash')).toHaveCount(0, { timeout: 40_000 });
  await page.getByRole('button', { name: 'Encontrar melhorias', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Encontrar melhorias', exact: true });
  await dialog.getByRole('combobox', { name: 'Objetivo da busca', exact: true }).selectOption('replace');
  const group = dialog.getByRole('group', { name: 'Slots que podem mudar (desmarque para manter)' });
  for (const checkbox of await group.getByRole('checkbox').all()) await checkbox.uncheck();
  await group.getByRole('checkbox', { name: 'Arma', exact: true }).check();
  await dialog.getByRole('combobox', { name: 'Slot para explorar ou fixar candidatos', exact: true }).selectOption('weapon');
  await dialog.getByLabel('Candidatos deste slot', { exact: false }).fill(String(fixture.preset.weapon));
  await dialog.getByLabel('Buscar cartas, encantamentos e bônus aleatórios', { exact: true }).uncheck();
  await dialog.getByLabel('Limite de cálculos', { exact: true }).fill('80');
  await dialog.getByRole('button', { name: 'Testar melhorias', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Resultados da análise' })).toBeVisible({ timeout: 40_000 });
  return dialog;
}

test('the panel is collapsed, loads only when opened, and never triggers another damage search', async ({ page }) => {
  const dialog = await search(page);
  const panel = dialog.locator('details.acq-panel');
  await expect(panel).toBeVisible();
  await expect(panel).not.toHaveAttribute('open', '');
  expect(await page.evaluate(() => window.__modes)).toEqual(['build']);
  const resultBefore = await dialog.locator('.improve-results table').first().innerText();
  const storedBefore = await page.evaluate(() => localStorage.getItem('ro-set'));

  await panel.locator('summary').click();
  await expect(panel.getByText(/componentes novos|Nenhuma obtenção nova/)).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText(/Base latam-acquisition/)).toBeVisible();
  // One read-only request; no new 'build', 'slot', 'stats' or 'explain' search.
  expect(await page.evaluate(() => window.__modes)).toEqual(['build', 'acquisition']);
  expect(await dialog.locator('.improve-results table').first().innerText()).toBe(resultBefore);
  expect(await page.evaluate(() => localStorage.getItem('ro-set'))).toBe(storedBefore);
  await expect(dialog.getByRole('button', { name: 'Comparar na calculadora', exact: true })).toBeEnabled();
});

test('a failed acquisition analysis keeps the optimized result and says so', async ({ page }) => {
  // The catalog is its own chunk: make that one fail to load.
  await page.route('**/analysis-*.js', async route => {
    const response = await route.fetch();
    if ((await response.text()).includes('latam-acquisition')) await route.abort('failed'); else await route.fulfill({ response });
  });
  const dialog = await search(page);
  await dialog.locator('details.acq-panel summary').click();
  await expect(dialog.locator('details.acq-panel').getByRole('alert')).toContainText('Análise de obtenção indisponível', { timeout: 30_000 });
  await expect(dialog.locator('details.acq-panel').getByRole('alert')).toContainText('A build otimizada não foi afetada');
  await expect(dialog.getByRole('heading', { name: 'Resultados da análise' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Comparar na calculadora', exact: true })).toBeEnabled();
});

test('details and sources load on demand from the real catalog', async ({ page }) => {
  await page.addInitScript(brief => { window.__stub = brief; }, briefs.temporalExactEnchant);
  const dialog = await search(page);
  const panel = dialog.locator('details.acq-panel');
  await panel.locator('summary').click();
  const entry = panel.locator('.acq-entry').first();
  await expect(entry).toContainText('Insígnia');
  expect(await page.evaluate(() => window.__modes)).toEqual(['build', 'acquisition']);
  await entry.locator('details summary').click();
  await expect(entry.locator('.acq-route').first()).toBeVisible({ timeout: 30_000 });
  await expect(entry.locator('.acq-route a').first()).toHaveAttribute('href', /^https?:\/\//);
  expect(await page.evaluate(() => window.__modes)).toEqual(['build', 'acquisition', 'acquisitionItem']);
});

const CASES = [
  { name: 'ended event', brief: briefs.temporalExpired, texts: ['Evento encerrado (rota expirada)', 'somente rotas encerradas', 'Configuração parcialmente documentada'], absent: ['impossível', 'inviável'] },
  { name: 'exact configuration, not just the base piece', brief: briefs.temporalExactEnchant, texts: ['Evento ou requisito excepcional', 'encantamento', 'Obter a peça-base não é obter a configuração exata', '1 preservados'], absent: ['Manopla'] },
  { name: 'unknown odds and unconfirmed LATAM availability', brief: briefs.visUnknown, texts: ['chance desconhecida', 'disponibilidade no LATAM não confirmada', 'Chance desconhecida, não é 0% nem 100%: 2'], absent: ['0%.'] },
  { name: 'no documented procedure', brief: briefs.noProcedure, texts: ['Sem procedimento documentado (1)', 'Nenhum componente novo tem rota documentada', 'Sem informação na base, não impossível'], absent: ['Configuração documentada:', 'Evento'] },
  { name: 'nothing new to obtain', brief: briefs.unchanged, texts: ['Nenhuma obtenção nova'], absent: ['Sem procedimento'] },
];
for (const { name, brief, texts, absent } of CASES) {
  test(`renders ${name} from a real service output`, async ({ page }) => {
    await page.addInitScript(stub => { window.__stub = stub; }, brief);
    const dialog = await search(page);
    const panel = dialog.locator('details.acq-panel');
    await panel.locator('summary').click();
    await expect(panel).toContainText(texts[0], { timeout: 30_000 });
    // The "no procedure" group is itself collapsed: open it before reading.
    for (const group of await panel.locator('details:not([open]) > summary').all()) if ((await group.innerText()).startsWith('Sem procedimento')) await group.click();
    for (const text of texts) await expect(panel).toContainText(text);
    for (const text of absent) await expect(panel).not.toContainText(text);
  });
}

test('stays usable at phone width with the panel open', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(stub => { window.__stub = stub; }, briefs.visUnknown);
  const dialog = await search(page);
  await dialog.locator('details.acq-panel summary').click();
  await expect(dialog.locator('.acq-entry').first()).toBeVisible({ timeout: 30_000 });
  expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  const box = await dialog.locator('details.acq-panel').boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
});
