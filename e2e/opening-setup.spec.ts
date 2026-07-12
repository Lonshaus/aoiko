import { expect, test } from '@playwright/test';
import { acceptDisclaimer } from './helpers';
// 開業精霊：開業費・転用資産を入力 → 確認 → 作成 → 仕訳一覧に反映されるまでのゴールデンパス。
// 未償却残高の計算式そのものは Vitest（business-opening.test.ts）で網羅済み、ここは UI フロー中心。
test('開業費・転用資産を登録 → 仕訳一覧に反映される', async ({ page }) => {
  await page.goto('/');
  await acceptDisclaimer(page);

  await page.goto('/opening-setup');

  // 開業日を固定し、未償却残高の期待値（255,180）を実行時刻に依存させない。
  const dateInputs = page.locator('input[type=date]');
  await dateInputs.nth(0).fill('2022-01-01');

  await page.getByPlaceholder('項目名（例：名刺作成）').fill('名刺作成');
  await page.getByPlaceholder('金額').first().fill('10000');
  await page.getByRole('button', { name: '追加' }).first().click();
  await expect(page.getByText('名刺作成')).toBeVisible();

  await page.getByPlaceholder('名前（例：MacBook Pro）').fill('パソコン');
  await dateInputs.nth(1).fill('2020-11-01');
  await page.getByPlaceholder('取得価額').fill('300000');
  await page.locator('input[type=number][min="1"][max="50"]').fill('4');
  await page.getByRole('button', { name: '追加' }).nth(1).click();
  await expect(page.getByText('私用期間の減価額 ¥44,820／開業時未償却残高 ¥255,180')).toBeVisible();

  await page.getByRole('button', { name: '確認画面へ' }).click();
  await expect(page.getByText('転用資産：1 件')).toBeVisible();

  await page.getByRole('button', { name: '作成する' }).click();
  await expect(page.getByText('開業時の仕訳・固定資産を作成しました。')).toBeVisible();

  await page.goto('/journal');
  await page.locator('input[type=number]').first().fill('2022');
  await page.locator('select').first().selectOption({ label: '全月' });
  await expect(page.getByText('開業費計上（開業精霊）')).toBeVisible();
  await expect(page.getByText('開業時資産計上（開業精霊）')).toBeVisible();
  await expect(page.getByText('¥255,180').first()).toBeVisible();
});
