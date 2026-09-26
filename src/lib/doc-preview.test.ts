import { afterEach, describe, expect, test, vi } from 'vitest';
import { foldModules, readPreviewPlatform, writePreviewPlatform } from './doc-preview';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('readPreviewPlatform', () => {
  test('未設定なら fallback を返す', () => {
    expect(readPreviewPlatform('browser')).toBe('browser');
  });

  test('無効な値なら fallback を返す', () => {
    localStorage.setItem('aoiko.devDocPreviewPlatform', 'not-a-platform');
    expect(readPreviewPlatform('browser')).toBe('browser');
  });

  test('有効な値ならその値を返す', () => {
    localStorage.setItem('aoiko.devDocPreviewPlatform', 'macos');
    expect(readPreviewPlatform('browser')).toBe('macos');
  });

  test('getItem が例外を投げたら fallback を返す', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(readPreviewPlatform('windows')).toBe('windows');
  });
});

describe('writePreviewPlatform', () => {
  test('setItem が例外を投げても投げ返さない', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('boom');
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
