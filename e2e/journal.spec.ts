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
// 全角数字は number 欄の値として何が届くかがブラウザ次第のため、実ブラウザで保存値まで確かめる。
test('全角数字で入力した金額は半角の標準の形で保存される', async ({ page, browserName }) => {
  test.skip(browserName === 'firefox', '全角数字を number 欄の値として受け取らない');
  await page.goto('/');
  await acceptDisclaimer(page);

  const today = new Date().toISOString().slice(0, 10);
  await page.locator('input[type="date"]').first().fill(today);
  await page.getByPlaceholder('例：電気代').fill('全角金額 e2e');
  await page.locator('form select[required]').nth(0).selectOption('1110');
  await page.getByPlaceholder('金額').nth(0).pressSequentially('１０００');
  await page.locator('form select[required]').nth(1).selectOption('4110');
  // 借方の金額が貸方へ自動で入るため、空にしてから打つ
  await page.getByPlaceholder('金額').nth(1).clear();
  await page.getByPlaceholder('金額').nth(1).pressSequentially('１０００');

  await page.getByRole('button', { name: /仕訳を追加/ }).click();
  await expect(page.getByText('全角金額 e2e').first()).toBeVisible({ timeout: 5000 });

  const amounts = await page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('aoiko');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction('journalLines').objectStore('journalLines').getAll();
          req.onerror = () => reject(req.error);
          req.onsuccess = () => resolve((req.result as { amount: string }[]).map((l) => l.amount));
        };
      }),
  );
  expect(amounts).toEqual(['1000', '1000']);
});
