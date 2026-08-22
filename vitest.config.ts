import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // vite.config.ts の __APP_VERSION__ / __APP_COMMIT__ 参照（Settings.svelte 末尾）が
  // テスト実行時に ReferenceError にならないようダミー値を定義する。
  define: {
    __APP_VERSION__: JSON.stringify('test'),
    __APP_COMMIT__: JSON.stringify('test'),
    // 購入画面のテストを走らせたいので、テストではネイティブ版として扱う。
    __NATIVE__: JSON.stringify(true),
  },
  plugins: [svelte()],
  resolve: {
    // 既定の Node 解決条件だと svelte が index-server.js（SSR 版）に解決され、
    // コンポーネントテストの mount() が lifecycle_function_unavailable で落ちる。
    conditions: ['browser'],
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./vitest.setup.ts'],
    globals: false,
    include: ['src/**/*.test.{ts,svelte.ts}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/_template.*.test.ts'],
  },
});
