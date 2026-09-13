import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath, URL } from 'node:url';

// 既定の Node 解決条件だと svelte が index-server.js（SSR 版）に解決され、
// コンポーネントテストの mount() が lifecycle_function_unavailable で落ちる。
const resolve = {
  conditions: ['browser'],
  alias: {
    $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
  },
};

const sharedTest = {
  environment: 'happy-dom',
  setupFiles: ['./vitest.setup.ts'],
  globals: false,
  exclude: ['**/node_modules/**', '**/dist/**', '**/_template.*.test.ts'],
};

export default defineConfig({
  test: {
    // native / web で __NATIVE__ の畳み込みが違うため、同じテストプロセスに
    // 2 つの Vite 環境を projects として持たせる。web 側の産物は build 時に
    // __NATIVE__ が false へ畳まれ、native 側のテストではそこが死んだ分岐になる。
    projects: [
      {
        plugins: [svelte()],
        resolve,
        define: {
          __APP_VERSION__: JSON.stringify('test'),
          __APP_COMMIT__: JSON.stringify('test'),
          // 購入画面等のテストを走らせたいので、こちら側はネイティブ版として扱う。
          __NATIVE__: JSON.stringify(true),
        },
        test: {
          ...sharedTest,
          name: 'native',
          include: ['src/**/*.test.{ts,svelte.ts}'],
          exclude: [...sharedTest.exclude, '**/*.web.test.ts'],
        },
      },
      {
        plugins: [svelte()],
        resolve,
        define: {
          __APP_VERSION__: JSON.stringify('test'),
          __APP_COMMIT__: JSON.stringify('test'),
          __NATIVE__: JSON.stringify(false),
        },
        test: {
          ...sharedTest,
          name: 'web',
          include: ['src/**/*.web.test.ts'],
        },
      },
    ],
  },
});
