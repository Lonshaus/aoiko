// scripts/tesseract-cache.ts の CACHE_PREFIX と揃える
// （そちらは node:crypto を使うため build 専用。browser 実行のこちらとは分けて持つ）。
const CACHE_PREFIX = 'aoiko-tesseract-';

export function staleTesseractCaches(cacheNames: readonly string[], keepName: string): string[] {
  return cacheNames.filter((name) => name.startsWith(CACHE_PREFIX) && name !== keepName);
}
// 実際の CacheStorage は match/open 等も持つが、掃除に要るのはこの 2 つだけ。
// 絞ることで、テストで undefined と偽物のどちらも渡しやすくする。
export interface TesseractCacheStorage {
  keys(): Promise<string[]>;
  delete(cacheName: string): Promise<boolean>;
}
// http（非セキュアコンテキスト）では caches 自体が存在しない。main.ts の起動を止めないよう、
// undefined も例外を投げない入力として受け付け、失敗しても外へ投げない。
export async function cleanupStaleTesseractCaches(
  cacheStorage: TesseractCacheStorage | undefined,
  keepName: string,
): Promise<void> {
  if (!cacheStorage) {
    return;
  }
  try {
    const names = await cacheStorage.keys();
    await Promise.all(
      staleTesseractCaches(names, keepName).map((name) => cacheStorage.delete(name)),
    );
  } catch {
    // 掃除ができなくてもアプリの起動は続けられる必要がある。
  }
}
