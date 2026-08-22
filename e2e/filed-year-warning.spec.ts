import { expect, test } from '@playwright/test';
import { acceptDisclaimer } from './helpers';

const today = new Date().toISOString().slice(0, 10);

async function addEntry(page: import('@playwright/test').Page, description: string): Promise<void> {
  await page.locator('input[type="date"]').first().fill(today);
  await page.getByPlaceholder('例：電気代').fill(description);
  await page.locator('form select[required]').nth(0).selectOption('1110');
  await page.getByPlaceholder('金額').nth(0).fill('10000');
  await page.locator('form select[required]').nth(1).selectOption('4110');
  await page.getByPlaceholder('金額').nth(1).fill('10000');
  await page.getByRole('button', { name: /仕訳を追加/ }).click();
}
// 申告済みの年度へ書き込む前に警告が出て、続行を選べば書き込まれること（#339）。
// 硬く擋がないのが仕様なので、「出る」だけでなく「続行できる」ところまで確認する。
test('申告済み年度への記帳は警告後に続行できる', async ({ page }) => {
  await page.goto('/');
  await acceptDisclaimer(page);
  await addEntry(page, 'ロック前の売上 e2e');
  await expect(page.getByText('ロック前の売上 e2e').first()).toBeVisible({ timeout: 5000 });

  await page.getByRole('link', { name: 'レポート' }).first().click();
  await page.getByRole('button', { name: '申告済みとしてロック' }).click();
  await page.getByRole('button', { name: 'ロックする' }).click();
  await expect(page.getByText('🔒 申告済み').first()).toBeVisible({ timeout: 5000 });

  await page.getByRole('link', { name: 'ホーム' }).first().click();
  await addEntry(page, 'ロック後の売上 e2e');

  await expect(page.getByText('申告済みの年度に記帳します')).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: '続行する' }).click();
  await expect(page.getByText('ロック後の売上 e2e').first()).toBeVisible({ timeout: 5000 });
});
