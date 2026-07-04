import { defineConfig, devices } from '@playwright/test';

// e2e は実 IDB 上での挙動・Svelte 5 + Dexie + PWA 統合を検証する。
// ドメインロジックは Vitest で網羅済み。重複は避け、UI フロー中心。
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:10708',
    locale: 'ja-JP',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:10708',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});