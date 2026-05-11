import { expect, test } from '@playwright/test';
import { acceptDisclaimer } from './helpers';

// 仕訳の新規作成 → 直近一覧に反映までのゴールデンパス。
test('新規仕訳作成 → 直近一覧に表示される', async ({ page }) => {
  await page.goto('/');
  await acceptDisclaimer(page);

  const today = new Date().toISOString().slice(0, 10);
  await page.locator('input[type="date"]').first().fill(today);
  await page.getByPlaceholder('例：電気代').fill('テスト売上 e2e');

  // フォーム構造：各行 = 科目 select + 税率 select（補助科目があれば追加）
  // 1110 現金 / 4110 売上高 は補助科目なしなので：
  //   nth(0) = 借方科目、nth(1) = 借方税率、nth(2) = 貸方科目、nth(3) = 貸方税率
  await page.locator('form select').nth(0).selectOption('1110');
  await page.getByPlaceholder('金額').nth(0).fill('10000');

  await page.locator('form select').nth(2).selectOption('4110');
  await page.getByPlaceholder('金額').nth(1).fill('10000');

  await page.getByRole('button', { name: /仕訳を追加/ }).click();

  await expect(page.getByText('テスト売上 e2e').first()).toBeVisible({ timeout: 5000 });
});