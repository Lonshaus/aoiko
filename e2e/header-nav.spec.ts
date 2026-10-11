import { expect, test, type Page } from '@playwright/test';
import { acceptDisclaimer } from './helpers';
// ヘッダー nav は 1024px（lg）未満ではハンバーガー、以上では 1 行のインライン表示になる。

const LOCALES = ['ja', 'en', 'zh-TW'] as const;
const MENU_WIDTHS = [768, 834, 951, 1023];
const INLINE_WIDTHS = [1024, 1280];
const NAV_COUNT = 11;

async function openApp(page: Page, locale: string, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await acceptDisclaimer(page);
  await page.evaluate((l) => localStorage.setItem('PARAGLIDE_LOCALE', l), locale);
  await page.reload();
  const accept = page.getByTestId('disclaimer-accept');
  if (await accept.isVisible({ timeout: 1000 }).catch(() => false)) {
    await acceptDisclaimer(page);
  }
}

for (const locale of LOCALES) {
  for (const width of MENU_WIDTHS) {
    test(`${locale} ${width}px: ハンバーガーで開閉・遷移できる`, async ({ page }) => {
      await openApp(page, locale, width);
      const inlineNav = page.locator('header nav').first();
      const button = page.locator('header button[aria-expanded]');
      await expect(inlineNav).toBeHidden();
      await expect(button).toBeVisible();
      await button.click();
      const panelLinks = page.locator('header > nav a');
      await expect(panelLinks).toHaveCount(NAV_COUNT);
      await panelLinks.last().click();
      await expect(page).not.toHaveURL(/\/$/);
      await expect(page.locator('header > nav')).toHaveCount(0);
    });
  }

  for (const width of INLINE_WIDTHS) {
    test(`${locale} ${width}px: インライン nav が 1 行で表示される`, async ({ page }) => {
      await openApp(page, locale, width);
      const inlineNav = page.locator('header nav').first();
      await expect(inlineNav).toBeVisible();
      await expect(page.locator('header button[aria-expanded]')).toBeHidden();
      const links = inlineNav.locator('a');
      await expect(links).toHaveCount(NAV_COUNT);
      const tops = await links.evaluateAll((els) =>
        els.map((e) => Math.round(e.getBoundingClientRect().top)),
      );
      expect(new Set(tops).size).toBe(1);
    });
  }
}
