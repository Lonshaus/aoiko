import { expect, test, type Page } from '@playwright/test';
import { acceptDisclaimer } from './helpers';
// 耐用年数の欄の上限はブラウザの検証ではなく app の検査で決める（ブラウザの検証は送信そのものを止める）。
async function addConvertedAsset(page: Page, life: string): Promise<void> {
  await page.goto('/');
  await acceptDisclaimer(page);
  await page.goto('/opening-setup');
  await page.locator('input[name="jigyoStartDate"]').fill('2022-01-01');
  await page.locator('input[name="convertedAssetTitle"]').fill('私用 PC');
  await page.locator('input[name="convertedAssetAcquisitionDate"]').fill('2020-11-01');
  await page.locator('input[name="convertedAssetAcquisitionCost"]').fill('300000');
  await page.locator('input[name="convertedAssetUsefulLife"]').fill(life);
  await page
    .locator('form', { has: page.locator('input[name="convertedAssetTitle"]') })
    .getByRole('button', { name: '追加' })
    .click();
}

test('転用資産の耐用年数 67 年は追加できる', async ({ page }) => {
  await addConvertedAsset(page, '67');
  await expect(page.locator('li', { hasText: '私用 PC' })).toHaveCount(1);
});

test('転用資産の耐用年数 68 年は理由を示して追加しない', async ({ page }) => {
  await addConvertedAsset(page, '68');
  await expect(page.getByText('転用資産の耐用年数は 2〜67 年で入力してください')).toBeVisible();
  await expect(page.locator('li', { hasText: '私用 PC' })).toHaveCount(0);
});

test('設定画面の定額法の資産は耐用年数 51 年で追加できる', async ({ page }) => {
  await page.goto('/');
  await acceptDisclaimer(page);
  await page.goto('/settings');
  const form = page.locator('form', { has: page.locator('input[name="assetTitle"]') });
  await form.locator('input[name="assetTitle"]').fill('鉄骨倉庫');
  await form.locator('input[name="assetAcquisitionDate"]').fill('2026-01-01');
  await form.locator('input[name="assetAcquisitionCost"]').fill('5000000');
  await form.locator('input[name="assetUsefulLife"]').fill('51');
  await form.getByRole('button', { name: '追加' }).click();
  await expect(page.locator('td', { hasText: '鉄骨倉庫' })).toBeVisible();
});
