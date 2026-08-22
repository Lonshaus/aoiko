import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { stashRestoreNotice, takeRestoreNotice } from './restore-notice';

const KEY = 'aoiko:restore-notice';

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('restore-notice', () => {
  test('預けた内容をそのまま取り出せる', () => {
    stashRestoreNotice({ tables: 12, rows: 3400, missingBlobCount: 2 });
    expect(takeRestoreNotice()).toEqual({ tables: 12, rows: 3400, missingBlobCount: 2 });
  });
  // 残したままだと、以後の再読み込みのたびに同じ復元完了メッセージが出続ける。
  test('一度取り出したら消える', () => {
    stashRestoreNotice({ tables: 1, rows: 1, missingBlobCount: 0 });
    takeRestoreNotice();
    expect(takeRestoreNotice()).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  test('何も預けていなければ null', () => {
    expect(takeRestoreNotice()).toBeNull();
  });

  test('壊れた値・別形式の値は null として扱い、残さない', () => {
    sessionStorage.setItem(KEY, '{');
    expect(takeRestoreNotice()).toBeNull();
    sessionStorage.setItem(KEY, JSON.stringify({ tables: '12', rows: 1, missingBlobCount: 0 }));
    expect(takeRestoreNotice()).toBeNull();
    sessionStorage.setItem(KEY, JSON.stringify(null));
    expect(takeRestoreNotice()).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
  // sessionStorage が使えない環境（あるブラウザ のプライベート閲覧等）でも復元自体は成立させる。
  test('sessionStorage が投げても復元処理を止めない', () => {
    vi.stubGlobal('sessionStorage', {
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      removeItem: () => {},
    });
    expect(() => stashRestoreNotice({ tables: 1, rows: 1, missingBlobCount: 0 })).not.toThrow();
    expect(takeRestoreNotice()).toBeNull();
    vi.unstubAllGlobals();
  });
});
