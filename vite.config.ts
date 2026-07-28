import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};
// PWA キャッシュ版の識別用。git の無いビルド環境（tarball 展開等）でも落ちないようフォールバック
function gitCommitShort(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    // 同じソースから作る別の配布形態は独立したバージョン体系を持つため、環境変数で
    // 上書きできるようにする。未設定なら package.json の値。
    __APP_VERSION__: JSON.stringify(process.env.AOIKO_VERSION ?? pkg.version),
    __APP_COMMIT__: JSON.stringify(gitCommitShort()),
  },
  plugins: [
    tailwindcss(),
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/paraglide',
      strategy: ['localStorage', 'preferredLanguage', 'baseLocale'],
    }),
    svelte(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: [
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/maskable-192.png',
        'icons/maskable-512.png',
      ],
      manifest: {
        name: 'aoiko - 青色申告ツール',
        short_name: 'aoiko',
        description:
          '個人事業主向けの青色申告 75 万円控除（令和 9 年分以降、要 e-Tax + 優良な電子帳簿）対応の記帳ツール',
        lang: 'ja',
        theme_color: '#15374a',
        background_color: '#15374a',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // SPA の history routing と相性のよい navigateFallback
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // .html / .css / .js / 画像 / フォント を precache
        globPatterns: ['**/*.{html,css,js,svg,png,ico,webmanifest,woff,woff2}'],
        // tesseract の worker とコアは合計 12MB 超。OCR エンジンに Tesseract を
        // 選んだ利用者だけが必要とするため precache から除外する（選んだ時点で
        // 通常のリクエストとして取得される）。
        globIgnores: ['tesseract/**'],
      },
      devOptions: {
        // 開発時もサービスワーカーを動かして挙動確認できる（任意）
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
    },
  },
  // Vite の既定値 5173 は他の Vite プロジェクトと衝突しやすいため、動的/private port 帯に変更。
  server: {
    port: 10708,
  },
  preview: {
    port: 31527,
  },
});
