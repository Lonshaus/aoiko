import { describe, expect, it } from 'vitest';
import { tesseractCacheHash, tesseractCacheName, tesseractRuntimeCaching } from './tesseract-cache';

describe('tesseractCacheHash', () => {
  it('同じ内容には同じハッシュを返す', () => {
    const assets = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
    expect(tesseractCacheHash(assets)).toBe(tesseractCacheHash([...assets]));
  });

  it('1 byte でも内容が変わればハッシュが変わる', () => {
    const before = [new Uint8Array([1, 2, 3])];
    const after = [new Uint8Array([1, 2, 4])];
    expect(tesseractCacheHash(before)).not.toBe(tesseractCacheHash(after));
  });

  it('ファイルの境界がずれても（内容の総和が同じでも）ハッシュが変わる', () => {
    const a = [new Uint8Array([1, 2]), new Uint8Array([3])];
    const b = [new Uint8Array([1]), new Uint8Array([2, 3])];
    expect(tesseractCacheHash(a)).not.toBe(tesseractCacheHash(b));
  });
});

describe('tesseractCacheName', () => {
  it('接頭辞付きの名前を返す', () => {
    expect(tesseractCacheName('abcd1234')).toBe('aoiko-tesseract-abcd1234');
  });
});

describe('tesseractRuntimeCaching', () => {
  const config = tesseractRuntimeCaching('aoiko-tesseract-abcd1234');

  it('CacheFirst を使う', () => {
    expect(config.handler).toBe('CacheFirst');
  });

  it('200 の応答だけを許すキャッシュ名を持つ', () => {
    expect(config.options?.cacheName).toBe('aoiko-tesseract-abcd1234');
    expect(config.options?.cacheableResponse?.statuses).toEqual([200]);
  });

  it('同一オリジンの /tesseract/ だけにマッチする', () => {
    const matcher = config.urlPattern as (args: { sameOrigin: boolean; url: URL }) => boolean;
    expect(
      matcher({
        sameOrigin: true,
        url: new URL('https://aoiko.pages.dev/tesseract/jpn.traineddata'),
      }),
    ).toBe(true);
    expect(
      matcher({ sameOrigin: true, url: new URL('https://aoiko.pages.dev/other/file.js') }),
    ).toBe(false);
    expect(
      matcher({
        sameOrigin: false,
        url: new URL('https://cdn.example.com/tesseract/jpn.traineddata'),
      }),
    ).toBe(false);
  });
});
