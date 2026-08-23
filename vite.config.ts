import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { stripBuildOnly } from './src/lib/build-only';
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

// tesseract-wasm の lib.js は worker とコアの既定位置を `new URL(..., import.meta.url)`
// で書いており、vite はこれを静的に見つけて assets/ へ複製する。aoiko は OCRClient に
// workerURL を明示で渡し、worker は自分の隣（/tesseract/）からコアを取るため、複製された
// ほうは実行時に一度も使われない。しかも vite が書き出した worker の中では
// tesseract-core-fallback.wasm の参照がハッシュ名へ書き換わっておらず、そもそも
// 使えば壊れる。放置すると配布物に約 1.9MB の死重が乗り、worker は .js なので
// precache にまで入る（OCR を使わない利用者まで取得してしまう）。
// 参照そのものは engine chunk の到達不能な分岐に残るが、実行されない。
function dropUnusedTesseractAssets() {
  const PATTERN = /^assets\/tesseract-(core|worker)-[^/]+\.(wasm|js)$/;
  return {
    name: 'aoiko-drop-unused-tesseract-assets',
    generateBundle(_options: unknown, bundle: Record<string, unknown>) {
      const hit = Object.keys(bundle).filter((f) => PATTERN.test(f));
      // 上流の作りが変わって複製が出なくなったら、この plugin は役目を終えている。
      // 黙って何もしないと消したつもりのものが残り続けるので気付けるようにする。
      if (hit.length === 0) {
        throw new Error(
          'tesseract-wasm の複製資産が見つからない。上流の変更でこの plugin が不要になった可能性がある。',
        );
      }
      for (const file of hit) {
        delete bundle[file];
      }
    },
  };
}

// 手引きは 1 つの markdown を両方の配布形態で読む。片方にしか当てはまらない節は
// `<!-- only:… -->` で囲み、ここで取り除く。表示時に隠すのでは産物に文章が残り、
// console から呼び出せてしまう（購入画面を __NATIVE__ で畳んでいるのと同じ理由）。
function stripDocsForBuild(native: boolean) {
  const MANUAL = /\/(docs\/manual\/[^/]+|DISCLAIMER|PRIVACY|SECURITY)(_[\w-]+)?\.md$/;
  return {
    name: 'aoiko-strip-docs-for-build',
    enforce: 'pre' as const,
    load(id: string) {
      const [file, query] = id.split('?');
      if (query !== 'raw' || file === undefined || !MANUAL.test(file)) {
        return null;
      }
      const name = file.slice(file.lastIndexOf('/') + 1);
      return `export default ${JSON.stringify(stripBuildOnly(readFileSync(file, 'utf-8'), native, name))}`;
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    // 同じソースから作る別の配布形態は独立したバージョン体系を持つため、環境変数で
    // 上書きできるようにする。未設定なら package.json の値。
    __APP_VERSION__: JSON.stringify(process.env.AOIKO_VERSION ?? pkg.version),
    __APP_COMMIT__: JSON.stringify(gitCommitShort()),
    // ネイティブ版のビルドでだけ true。商店を持たない web に購入画面を含めないため、
    // 実行時の判定ではなくここで畳む。false になった側は import ごと落ちる。
    __NATIVE__: JSON.stringify(process.env.AOIKO_NATIVE === '1'),
  },
  plugins: [
    stripDocsForBuild(process.env.AOIKO_NATIVE === '1'),
    dropUnusedTesseractAssets(),
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
        // 免責同意画面と設定画面から開く著作権表示は、SPA のルートではなく実ファイル。
        // 除外しないと navigation として index.html が返り、router が知らない経路として
        // 404 画面になる（SW 導入後のみ起きるため、開発中は気付けない）。
        navigateFallbackDenylist: [/^\/api\//, /^\/THIRD_PARTY_LICENSES\.txt$/],
        // .html / .css / .js / 画像 / フォント を precache
        globPatterns: ['**/*.{html,css,js,svg,png,ico,webmanifest,woff,woff2}'],
        // tesseract-wasm の worker・コア・日本語モデルは合計 6MB 超。OCR エンジンに
        // Tesseract を選んだ利用者だけが必要とするため precache から除外する
        // （選んだ時点で通常のリクエストとして取得される）。
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
