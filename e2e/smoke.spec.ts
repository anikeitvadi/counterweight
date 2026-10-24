import { expect, test, type Page } from '@playwright/test';

/** Live smoke test against the real public APIs: each asset loads, the heatmap paints, no console errors. */
async function expectDeskLoaded(page: Page) {
  // the heatmap is a canvas inside the lightweight-charts container
  await expect(page.locator('.lwc canvas').first()).toBeVisible();
  // the price tile shows a number
  await expect(page.locator('.tile.hero-tile .val')).not.toHaveText('—');
  // options maths produced a max pain
  await expect(page.getByText(/^Max pain/).first()).toBeVisible();
}

test.describe('CryptoDesk smoke', () => {
  test('loads BTC, ETH and gold without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto('/');
    await expectDeskLoaded(page);
    for (const asset of ['ETH', 'Gold', 'BTC']) {
      await page.getByRole('tab', { name: asset }).click();
      await expectDeskLoaded(page);
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('panels can be hidden and the choice persists', async ({ page }) => {
    await page.goto('/');
    await expectDeskLoaded(page);
    await page.getByRole('button', { name: 'Indicators and display settings' }).click();
    await page.getByRole('checkbox', { name: 'Gamma exposure' }).uncheck();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Gamma exposure' })).toHaveCount(0);
    await page.reload();
    await expectDeskLoaded(page);
    await expect(page.getByRole('heading', { name: 'Gamma exposure' })).toHaveCount(0);
  });

  test('widget mode shows the ratio hero and persists via the hash', async ({ page }) => {
    await page.goto('/#widget');
    await expect(page.getByRole('heading', { name: 'Put / call ratio' })).toBeVisible();
    await expect(page.locator('.ratio .big')).not.toHaveText('', { timeout: 45_000 });
    await expect(page.locator('.lwc')).toHaveCount(0);
    await page.keyboard.press('w');
    await expect(page.locator('.lwc canvas').first()).toBeVisible();
  });

  test('health endpoint relay path works through the dev proxy', async ({ request }) => {
    const r = await request.get('/api/okx/rubik/stat/contracts/open-interest-history?instId=BTC-USDT-SWAP&period=1H&limit=1');
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(body.code).toBe('0');
  });
});
