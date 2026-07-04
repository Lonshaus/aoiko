import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { paraglideVitePlugin } from '@inlang/paraglide-js'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
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
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-192.png', 'icons/maskable-512.png'],
      manifest: {
        name: 'aoiko - 青色申告ツール',
        short_name: 'aoiko',
        description: '個人事業主向けの青色申告 75 万円控除（令和 9 年分以降、要 e-Tax + 優良な電子帳簿）対応の記帳ツール',
        lang: 'ja',
        theme_color: '#15374a',
        background_color: '#15374a',
        display: 'standalone',
        orientation: 'portrait',
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
})