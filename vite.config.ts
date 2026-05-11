import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { copyFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    svelte(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/icon.svg', 'icons/maskable.svg'],
      manifest: {
        name: 'aoiko - 青色申告ツール',
        short_name: 'aoiko',
        description: '個人事業主向けの青色申告 65 万円控除対応の記帳ツール',
        lang: 'ja',
        theme_color: '#15374a',
        background_color: '#15374a',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'icons/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'icons/maskable.svg',
            sizes: 'any',
            type: 'image/svg+xml',
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
    {
      // GitHub Pages 用：ビルド後 dist/index.html を dist/404.html に複製。
      // history routing で直接 URL を叩いた時、GitHub が 404.html を返すと SPA が起動して所定ルートを描画する。
      // Cloudflare Pages / Netlify は public/_redirects が優先されるためこの 404.html は使われない（無害）。
      name: 'spa-404-fallback',
      apply: 'build',
      closeBundle() {
        copyFileSync('dist/index.html', 'dist/404.html')
      },
    },
  ],
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
    },
  },
})