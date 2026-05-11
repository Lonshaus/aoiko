import { expect, test } from '@playwright/test';

// 各ルートが読み込めて主要見出しが表示されるかの最低限スモークテスト。
// IndexedDB シードは src/db/seed.ts が onMount で走る前提。

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
  await context.clearPermissions();
});

test('home ルートが読み込まれる', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '新規仕訳' })).toBeVisible();
});

test('一覧ルート', async ({ page }) => {
  await page.goto('/journal');
  await expect(page.getByRole('link', { name: 'aoiko' })).toBeVisible();
});

test('レポートルート', async ({ page }) => {
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'レポート' })).toBeVisible();
});

test('インポートルート', async ({ page }) => {
  await page.goto('/import');
  await expect(page.getByRole('link', { name: 'インポート' })).toBeVisible();
});

test('設定ルート', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '設定' })).toBeVisible();
});

test('ナビゲーション：home → reports → settings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'レポート' }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await page.getByRole('link', { name: '設定' }).click();
  await expect(page).toHaveURL(/\/settings$/);
});