import { expect, test } from '@playwright/test';
import { acceptDisclaimer } from './helpers';
// 仕訳の新規作成 → 直近一覧に反映までのゴールデンパス。
test('新規仕訳作成 → 直近一覧に表示される', async ({ page }) => {
  await page.goto('/');
  await acceptDisclaimer(page);

  const today = new Date().toISOString().slice(0, 10);
  await page.locator('input[type="date"]').first().fill(today);
  await page.getByPlaceholder('例：電気代').fill('テスト売上 e2e');
  // 科目 select だけが required 属性を持つ（税率・税区分・用途区分等は無し）ため、
  // 科目選択後に追加で出現する行（税区分・用途区分 select）の数に影響されず
  // 借方/貸方の科目 select を安定して特定できる。
  await page.locator('form select[required]').nth(0).selectOption('1110');
  await page.getByPlaceholder('金額').nth(0).fill('10000');

  await page.locator('form select[required]').nth(1).selectOption('4110');
  await page.getByPlaceholder('金額').nth(1).fill('10000');

  await page.getByRole('button', { name: /仕訳を追加/ }).click();

  await expect(page.getByText('テスト売上 e2e').first()).toBeVisible({ timeout: 5000 });
});
