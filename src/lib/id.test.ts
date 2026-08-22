import { afterEach, describe, expect, test, vi } from 'vitest';
import { newId } from './id';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// randomUUID だけ未定義にした crypto を差し込む。getRandomValues はネイティブメソッドで
// this 束縛が必要なため、spread ではなく Proxy 越しに元の crypto へ委譲する。
function stubCryptoWithoutRandomUUID(): void {
  const proxy = new Proxy(crypto, {
    get(target, prop) {
      if (prop === 'randomUUID') {
        return undefined;
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  vi.stubGlobal('crypto', proxy);
}

describe('newId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('セキュアコンテキストでは crypto.randomUUID をそのまま使う', () => {
    const id = newId();
    expect(id).toMatch(UUID_V4_RE);
  });

  test('crypto.randomUUID が無い環境（非セキュアコンテキスト）でも v4 形式の UUID を生成する', () => {
    stubCryptoWithoutRandomUUID();
    const id = newId();
    expect(id).toMatch(UUID_V4_RE);
  });

  test('フォールバック時も呼び出すたびに異なる値になる', () => {
    stubCryptoWithoutRandomUUID();
    const ids = new Set(Array.from({ length: 50 }, () => newId()));
    expect(ids.size).toBe(50);
  });
});
