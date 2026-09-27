import { describe, expect, it } from 'vitest';
import {
  cleanupStaleTesseractCaches,
  staleTesseractCaches,
  type TesseractCacheStorage,
} from './tesseract-cache-cleanup';

describe('staleTesseractCaches', () => {
  it('現在のキャッシュ以外の aoiko-tesseract- を返す', () => {
    const names = ['aoiko-tesseract-aaaa1111', 'aoiko-tesseract-bbbb2222', 'workbox-precache-v2'];
    expect(staleTesseractCaches(names, 'aoiko-tesseract-bbbb2222')).toEqual([
      'aoiko-tesseract-aaaa1111',
    ]);
  });

  it('現在のキャッシュは削除対象に含めない', () => {
    const names = ['aoiko-tesseract-bbbb2222'];
    expect(staleTesseractCaches(names, 'aoiko-tesseract-bbbb2222')).toEqual([]);
  });

  it('aoiko-tesseract- 以外の名前は残す', () => {
    const names = ['workbox-precache-v2', 'some-other-cache'];
    expect(staleTesseractCaches(names, 'aoiko-tesseract-bbbb2222')).toEqual([]);
  });
});

function fakeCacheStorage(names: string[]): TesseractCacheStorage & { deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    async keys() {
      return names;
    },
    async delete(name: string) {
      deleted.push(name);
      return true;
    },
  };
}

describe('cleanupStaleTesseractCaches', () => {
  it('caches が無い環境（http）では何もせず戻る', async () => {
    await expect(
      cleanupStaleTesseractCaches(undefined, 'aoiko-tesseract-bbbb2222'),
    ).resolves.toBeUndefined();
  });

  it('旧いキャッシュだけを削除する', async () => {
    const storage = fakeCacheStorage([
      'aoiko-tesseract-aaaa1111',
      'aoiko-tesseract-bbbb2222',
      'workbox-precache-v2',
    ]);
    await cleanupStaleTesseractCaches(storage, 'aoiko-tesseract-bbbb2222');
    expect(storage.deleted).toEqual(['aoiko-tesseract-aaaa1111']);
  });

  it('keys() が失敗しても外へ例外を投げない', async () => {
    const storage: TesseractCacheStorage = {
      async keys() {
        throw new Error('boom');
      },
      async delete() {
        return true;
      },
    };
    await expect(
      cleanupStaleTesseractCaches(storage, 'aoiko-tesseract-bbbb2222'),
    ).resolves.toBeUndefined();
  });
});
