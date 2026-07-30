import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
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
