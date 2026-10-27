import { test, expect } from '@playwright/test';

test.use({ launchOptions: { firefoxUserPrefs: { 'network.cookie.cookieBehavior': 2 } } });

test('サイトデータを全面ブロックしたブラウザでは白画面でなく起動エラー画面を出す', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'firefox', 'cookieBehavior の設定は Firefox 専用');
  const pageErrors: Error[] = [];
  page.on('pageerror', (e) => {
    pageErrors.push(e);
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'aoiko を起動できませんでした' })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
