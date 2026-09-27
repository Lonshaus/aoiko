// Tesseract の資産（worker・コア WASM・言語モデル）からキャッシュ名と
// vite-plugin-pwa の runtimeCaching 設定を組み立てる純粋関数。vite.config.ts から呼ぶ。
// node:crypto を使うため build 時（Node）専用。src/ の外に置き、svelte-check の対象からも外す。
import { createHash } from 'node:crypto';
import type { RuntimeCaching } from 'workbox-build';
// src/lib/ocr/tesseract-cache-cleanup.ts の CACHE_PREFIX と揃える
// （node:crypto を使うこのファイルを browser 実行のコードから import させないため、値を分けて持つ）。
export const CACHE_PREFIX = 'aoiko-tesseract-';

export function tesseractCacheHash(assets: readonly Uint8Array[]): string {
  const hash = createHash('sha256');
  for (const bytes of assets) {
    // ファイル境界を跨いだ内容の入れ替わりで同じハッシュにならないよう、長さも混ぜる。
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, bytes.length);
    hash.update(len);
    hash.update(bytes);
  }
  return hash.digest('hex').slice(0, 8);
}

export function tesseractCacheName(hash: string): string {
  return `${CACHE_PREFIX}${hash}`;
}

export function tesseractRuntimeCaching(cacheName: string): RuntimeCaching {
  return {
    urlPattern: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith('/tesseract/'),
    handler: 'CacheFirst',
    options: {
      cacheName,
      cacheableResponse: { statuses: [200] },
    },
  };
}
