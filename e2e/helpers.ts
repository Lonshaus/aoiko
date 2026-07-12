import type { Page } from '@playwright/test';
// DISCLAIMER モーダルを閉じてからテストを進める。
// 初回訪問では必ず表示されるため、ほとんどのテストの beforeEach で呼ぶ。
export async function acceptDisclaimer(page: Page): Promise<void> {
  await page.getByTestId('disclaimer-accept').click();
  await page.getByTestId('disclaimer-accept').waitFor({ state: 'detached' });
}
