import { chromium, type FullConfig } from '@playwright/test';
// dev server の初回リクエストは依存の最適化とモジュール変換で数秒かかる。
// boot.ts は main を動的 import するため goto の load では待てず、最初のテストの
// expect 5 秒がその分を負う。ここで一度表示まで通して温めておく。
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(baseURL ?? 'http://localhost:10708');
    await page.locator('#app > *').first().waitFor({ timeout: 60_000 });
  } finally {
    await browser.close();
  }
}
