import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// 出力先を repo の外へ置く。失敗時のスクリーンショット・動画・trace も HTML
// レポートも、消して困るものではない。repo フォルダには無いと動かないものだけを置く。
// CI では runner の一時領域を使う（TMPDIR が RUNNER_TEMP と一致する保証が無いため
// 環境変数から直接取り、workflow の artifact パスと確実に揃える）。
const artifactRoot = join(process.env.RUNNER_TEMP ?? tmpdir(), 'aoiko-playwright');
// e2e は実 IDB 上での挙動・Svelte 5 + Dexie + PWA 統合を検証する。
// ドメインロジックは Vitest で網羅済み。重複は避け、UI フロー中心。
export default defineConfig({
  testDir: './e2e',
  outputDir: join(artifactRoot, 'test-results'),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: join(artifactRoot, 'report') }]]
    : 'list',
  use: {
    baseURL: 'http://localhost:10708',
    locale: 'ja-JP',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  // Service Worker のキャッシュ確認は独立した project にする（下の pwa-chromium）。
  // dev server 側の project ではその spec を走らせない。
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: ['pwa/**'] },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testIgnore: ['pwa/**'] },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testIgnore: ['pwa/**'] },
    {
      name: 'pwa-chromium',
      // Service Worker の route 差し替え・Cache Storage の内容確認は Chromium 系専用の
      // CDP 前提が要り、Firefox / WebKit では Playwright から同じ形で観測できない。
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:31527' },
      testMatch: ['pwa/**'],
      // 1 テストで解析を 2 回走らせる（初回取得＋オフライン再解析）ため既定の 30 秒では足りない。
      timeout: 90_000,
    },
  ],
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:10708',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Service Worker は本物のビルド成果物でしか検証できない（dev server は生成しない）。
      command: 'npm run build && npm run preview -- --port 31527 --strictPort',
      url: 'http://localhost:31527',
      reuseExistingServer: !process.env.CI,
      // build 込みなので既定の 60 秒では足りない。
      timeout: 180_000,
    },
  ],
});
