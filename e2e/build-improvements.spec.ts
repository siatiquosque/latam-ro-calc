import { expect, Page, test } from '@playwright/test';
import fixture from '../mcp/src/engine/__tests__/fixtures/inquisitor-optimization.json';
import { ptBR } from '../src/app/i18n/pt-br';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(preset => {
    localStorage.setItem('ro-set', JSON.stringify(preset));
    localStorage.setItem('monster', '21077');
    localStorage.setItem('ro-right-accordion-active', '[]');
  }, fixture.preset);
  await page.route('**/mcp', route => route.abort('failed'));
});

async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('#ro-splash')).toHaveCount(0, { timeout: 40_000 });
  await page.getByRole('button', { name: 'Encontrar melhorias', exact: true }).click();
  return page.getByRole('dialog', { name: 'Encontrar melhorias', exact: true });
}

test('runs a restricted local search and opens the exact suggestion as a comparison, preserving the main build', async ({ page }) => {
  const dialog = await open(page);
  await dialog.getByRole('combobox', { name: 'Objetivo da busca', exact: true }).selectOption('replace');
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem('ro-set')!));
  const group = dialog.getByRole('group', { name: 'Slots que podem mudar (desmarque para manter)' });
  for (const checkbox of await group.getByRole('checkbox').all()) await checkbox.uncheck();
  await group.getByRole('checkbox', { name: ptBR['itemSlot.weapon'], exact: true }).check();
  await dialog.getByRole('combobox', { name: 'Slot para explorar ou fixar candidatos', exact: true }).selectOption('weapon');
  await dialog.getByLabel('Candidatos deste slot', { exact: false }).fill(String(fixture.preset.weapon));
  await dialog.getByLabel('Buscar cartas, encantamentos e bônus aleatórios', { exact: true }).uncheck();
  await dialog.getByLabel('Limite de cálculos', { exact: true }).fill('80');
  const worker = page.waitForEvent('worker');
  await dialog.getByRole('button', { name: 'Testar melhorias', exact: true }).click();
  await worker;
  await expect(dialog.getByRole('heading', { name: 'Resultados da análise' })).toBeVisible({ timeout: 40_000 });
  await expect(dialog.locator('table').first()).toContainText('dps');
  await expect(dialog.locator('.improve-piece').first()).toBeVisible();
  await expect(dialog.locator('.improve-piece').first().getByRole('columnheader', { name: ptBR['improve.before'], exact: true })).toBeVisible();
  await expect(dialog.locator('.improve-piece').first().getByRole('columnheader', { name: ptBR['improve.after'], exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Comparar na calculadora', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('ro-set-compare') || 'null'))).toMatchObject({ stats: true });
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('ro-set')!));
  for (const key of ['weapon', 'weaponRefine', 'boot', 'bootRefine', 'str', 'agi', 'vit']) expect(after[key]).toEqual(original[key]);
});

test('cancels a worker search and remains usable at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await open(page);
  await expect(dialog.getByRole('combobox', { name: 'Objetivo da busca', exact: true })).toHaveValue('current');
  const worker = page.waitForEvent('worker');
  await dialog.getByRole('button', { name: 'Testar melhorias', exact: true }).click();
  await worker;
  await dialog.getByRole('button', { name: 'Cancelar busca', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Testar melhorias', exact: true })).toBeEnabled();
  await expect.poll(() => page.workers().length).toBe(0);
  expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('explores a slot and compares a row with its measured sockets', async ({ page }) => {
  const dialog = await open(page);
  await dialog.getByRole('combobox', { name: 'O que testar', exact: true }).selectOption('slot');
  await dialog.getByLabel('Filtrar itens por nome', { exact: true }).fill('Soqueira Vil Invernal');
  await dialog.getByLabel('Buscar cartas, encantamentos e bônus aleatórios', { exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Testar melhorias', exact: true }).click();
  await expect(dialog.locator('tbody')).toContainText('Soqueira', { timeout: 40_000 });
  await dialog.getByRole('button', { name: 'Comparar na calculadora', exact: true }).first().click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('ro-set-compare') || 'null')?.model2?.weapon)).toBeGreaterThan(0);
});

test('shows damage stages and next upgrades without replacing equipment', async ({ page }) => {
  const dialog = await open(page);
  await dialog.getByRole('combobox', { name: 'O que testar', exact: true }).selectOption('explain');
  await dialog.getByRole('button', { name: 'Testar melhorias', exact: true }).click();
  await expect(dialog.getByText('Etapas do dano', { exact: true })).toBeVisible({ timeout: 40_000 });
  await expect(dialog.getByText('Próximos upgrades', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Comparar na calculadora', exact: true })).toHaveCount(0);
});

test('redistributes stats and reports the measured before and after values', async ({ page }) => {
  const dialog = await open(page);
  await dialog.getByRole('combobox', { name: 'O que testar', exact: true }).selectOption('stats');
  await dialog.getByLabel('Limite de cálculos', { exact: true }).fill('80');
  await dialog.getByRole('button', { name: 'Testar melhorias', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Resultados da análise' })).toBeVisible({ timeout: 40_000 });
  await expect(dialog.locator('table')).toContainText('dps');
  await expect(dialog.getByRole('button', { name: 'Comparar na calculadora', exact: true })).toBeEnabled();
});
