import { expect, Page, test } from '@playwright/test';
import fixture from '../mcp/src/engine/__tests__/fixtures/inquisitor-optimization.json';

declare global { interface Window { __requests: any[] } }

test.beforeEach(async ({ page }) => {
  await page.addInitScript(preset => {
    localStorage.setItem('ro-set', JSON.stringify(preset));
    localStorage.setItem('monster', '21077');
    localStorage.setItem('ro-right-accordion-active', '[]');
    // Records every request the dialog sends to an analysis worker, then lets it run for real.
    window.__requests = [];
    const Real = window.Worker;
    window.Worker = class extends Real {
      override postMessage(message: any, ...rest: any[]) {
        window.__requests.push({ mode: message?.mode, args: message?.args && { ...message.args, build: undefined } });
        (super.postMessage as any)(message, ...rest);
      }
    };
  }, fixture.preset);
  await page.route('**/mcp', route => route.abort('failed'));
});

async function openDialog(page: Page) {
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
  await dialog.getByLabel('Orçamento de avaliações da busca', { exact: true }).fill('80');
  return dialog;
}

test('goal, extra targets, constraints and locked slots reach the core as the MCP contract', async ({ page }) => {
  const dialog = await openDialog(page);
  await dialog.locator('summary', { hasText: 'Metas, alvos e restrições' }).click();
  await dialog.getByRole('button', { name: 'Adicionar alvo' }).click();
  await dialog.getByLabel('Alvo adicional').selectOption('9000002');
  await dialog.getByLabel('Golpes no máximo para abater cada alvo').fill('2');
  await dialog.getByLabel('Margem de dano mínima (%)').fill('10');
  await dialog.getByLabel('Crítico efetivo mínimo (%)').fill('5');
  await dialog.getByLabel('Cartas MVP').selectOption('none');
  await dialog.getByLabel('Refino máximo de qualquer peça').fill('12');
  await dialog.getByLabel('Efeitos ativos proibidos').fill('Oleum Sanctum');
  await dialog.getByLabel('Máximo de consumíveis').fill('3');
  await dialog.getByLabel('Permitir buffs externos novos').uncheck();
  await dialog.getByLabel('Permitir redistribuir atributos').uncheck();
  await dialog.getByRole('button', { name: 'Testar melhorias', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Resultados da análise' })).toBeVisible({ timeout: 60_000 });

  const [request] = await page.evaluate(() => window.__requests.filter(entry => entry.mode === 'build'));
  expect(request.args.goal).toEqual({ maxHitsToKill: 2, margin: 0.1, minCritRate: 5 });
  expect(request.args.constraints).toEqual({
    mvpPolicy: 'none', maxRefine: 12, forbiddenEffects: ['Oleum Sanctum'], consumables: { max: 3 }, allowExternalBuffs: false, allowStatReset: false,
  });
  expect(request.args.targets.map((aim: any) => aim.monsterId)).toContain(9000002);
  expect(request.args.targets).toHaveLength(2);
  // Every slot the player left unchecked is locked; only the weapon is searched.
  expect(request.args.slots).toEqual(['weapon']);
  expect(request.args.lock).not.toContain('weapon');
  expect(request.args.lock.length).toBeGreaterThan(10);
  // The core's verdict is shown, with the baseline and a per-target breakdown.
  const verdict = dialog.getByRole('complementary', { name: 'Viabilidade por alvo e confiabilidade' });
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText('Build de partida');
  await expect(verdict.getByText('Veredito por alvo')).toBeVisible();
});

test('without goal or constraints the request carries neither, and no verdict is shown', async ({ page }) => {
  const dialog = await openDialog(page);
  await dialog.getByRole('button', { name: 'Testar melhorias', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Resultados da análise' })).toBeVisible({ timeout: 60_000 });
  const [request] = await page.evaluate(() => window.__requests.filter(entry => entry.mode === 'build'));
  expect(request.args.goal).toBeUndefined();
  expect(request.args.constraints).toBeUndefined();
  expect(request.args.targets).toBeUndefined();
  await expect(dialog.getByRole('complementary', { name: 'Viabilidade por alvo e confiabilidade' })).toHaveCount(0);
});

test('a goal outside its bounds is blocked by the form and nothing runs', async ({ page }) => {
  const dialog = await openDialog(page);
  await dialog.locator('summary', { hasText: 'Metas, alvos e restrições' }).click();
  await dialog.getByLabel('Precisão (HIT) mínima').fill('-5');
  await dialog.getByRole('button', { name: 'Testar melhorias', exact: true }).click();
  // The numeric field's own bound blocks the submit; the dialog and values stay.
  await expect(dialog.getByLabel('Precisão (HIT) mínima')).toHaveValue('-5');
  await expect(dialog.getByRole('heading', { name: 'Resultados da análise' })).toHaveCount(0);
});

test('repeating a target is refused', async ({ page }) => {
  const dialog = await openDialog(page);
  await dialog.locator('summary', { hasText: 'Metas, alvos e restrições' }).click();
  await dialog.getByRole('button', { name: 'Adicionar alvo' }).click();
  const main = await dialog.getByRole('combobox', { name: 'Alvo', exact: true }).inputValue();
  await dialog.getByLabel('Alvo adicional').selectOption(main);
  await dialog.getByRole('button', { name: 'Testar melhorias', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Cada alvo só pode aparecer uma vez');
});
