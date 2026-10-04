import { afterEach, describe, expect, test, vi } from 'vitest';
import { foldModules, readPreviewPlatform, writePreviewPlatform } from './doc-preview';

afterEach(() => {
  // stub 中は localStorage.clear が無いので、先に本物へ戻してから消す。
  vi.unstubAllGlobals();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('readPreviewPlatform', () => {
  test('未設定なら代替値を返す', () => {
    expect(readPreviewPlatform('browser')).toBe('browser');
  });

  test('無効な値なら代替値を返す', () => {
    localStorage.setItem('aoiko.devDocPreviewPlatform', 'not-a-platform');
    expect(readPreviewPlatform('browser')).toBe('browser');
  });

  test('有効な値ならその値を返す', () => {
    localStorage.setItem('aoiko.devDocPreviewPlatform', 'macos');
    expect(readPreviewPlatform('browser')).toBe('macos');
  });

  test('getItem が例外を投げたら fallback を返す', () => {
    // happy-dom は Storage.prototype のメソッドを最初のアクセスでインスタンスへ束縛するため、
    // spyOn では順序次第で効かない場合がある。丸ごと差し替えて確実に例外を発生させる。
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('boom');
      },
    });
    expect(readPreviewPlatform('windows')).toBe('windows');
  });
});

describe('writePreviewPlatform', () => {
  test('setItem が例外を投げても投げ返さない', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('boom');
      },
    });
    expect(() => writePreviewPlatform('ios')).not.toThrow();
  });
});

describe('foldModules', () => {
  test('各値を畳む', () => {
    const modules = {
      'a.md': '<!-- only:browser -->\nA\n<!-- /only -->\n',
      'b.md': '<!-- only:native -->\nB\n<!-- /only -->\n',
    };
    const folded = foldModules(modules, 'macos');
    expect(folded['a.md']).toBe('');
    expect(folded['b.md']).toBe('B\n');
  });

  test('印が対になっていなければ path を含む例外を投げる', () => {
    const modules = { 'broken.md': '<!-- only:browser -->\nA\n' };
    expect(() => foldModules(modules, 'browser')).toThrow(/broken\.md/);
  });
});
