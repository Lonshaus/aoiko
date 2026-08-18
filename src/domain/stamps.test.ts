import { describe, test, expect } from 'vitest';
import {
  STAMPS_PER_PAGE,
  stampPageCount,
  stampPageSlots,
  stampRotation,
  type Stamp,
} from './stamps';

function stamps(n: number): Stamp[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    tier: 'bronze' as const,
    at: '2026-08-18',
  }));
}

describe('stampPageCount', () => {
  test('0 個でも 1 頁ある', () => {
    expect(stampPageCount(0)).toBe(1);
  });

  test('ちょうど 1 頁ぶんで 2 頁目を作らない', () => {
    expect(stampPageCount(STAMPS_PER_PAGE)).toBe(1);
  });

  test('1 個はみ出したら 2 頁', () => {
    expect(stampPageCount(STAMPS_PER_PAGE + 1)).toBe(2);
  });
});

describe('stampPageSlots', () => {
  test('埋まっていなくても常に 9 枠返す', () => {
    const slots = stampPageSlots(stamps(2), 0);
    expect(slots).toHaveLength(STAMPS_PER_PAGE);
    expect(slots.slice(2).every((s) => s === null)).toBe(true);
  });

  test('2 頁目は 10 個目から', () => {
    const slots = stampPageSlots(stamps(11), 1);
    expect(slots[0]?.id).toBe('s9');
    expect(slots[1]?.id).toBe('s10');
    expect(slots[2]).toBeNull();
  });

  test('存在しない頁を見ても落ちず、空の枠だけ返す', () => {
    expect(stampPageSlots(stamps(3), 5).every((s) => s === null)).toBe(true);
  });
});

describe('stampRotation', () => {
  test('同じ位置なら何度呼んでも同じ角度', () => {
    expect(stampRotation(4)).toBe(stampRotation(4));
  });

  test('表より後ろの位置でも角度が付く（0 に落ちない）', () => {
    for (let i = 0; i < 40; i++) {
      expect(stampRotation(i)).not.toBe(0);
    }
  });

  test('負の位置でも表の範囲に収める', () => {
    expect(stampRotation(-1)).toBe(stampRotation(11));
  });
});
