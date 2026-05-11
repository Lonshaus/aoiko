import { expect, test } from '@playwright/test';
import { acceptDisclaimer } from './helpers';

test('初回訪問でモーダル表示・同意後は非表示', async ({ page }) => {
  await page.goto('/');
  // 初回はモーダル表示
  await expect(page.getByRole('dialog', { name: 'aoiko へようこそ' })).toBeVisible();
  await expect(page.getByTestId('disclaimer-accept')).toBeVisible();
  // 同意
  await acceptDisclaimer(page);
  // 同一セッションでホーム本体が見える
  await expect(page.getByRole('heading', { name: '新規仕訳' })).toBeVisible();
});

test('再訪問ではモーダルが出ない', async ({ page }) => {
  await page.goto('/');
  await acceptDisclaimer(page);
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'aoiko へようこそ' })).not.toBeVisible();
  await expect(page.getByRole('heading', { name: '新規仕訳' })).toBeVisible();
});

test('設定から同意取消後は再びモーダル表示', async ({ page }) => {
  await page.goto('/');
  await acceptDisclaimer(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: /同意を取り消す/ }).click();
  // 取消はリロードを伴う実装
  await expect(page.getByRole('dialog', { name: 'aoiko へようこそ' })).toBeVisible();
});