import { describe, expect, it } from 'vitest';
import {
  STAMPS_PER_PAGE,
  STAMP_COLORS,
  STAMP_SHAPES,
  stampPageCount,
  stampPageSlots,
  stampRotation,
  type Stamp,
} from './stamps';

function stamp(i: number, shape = STAMP_SHAPES[0], color = STAMP_COLORS[0]): Stamp {
  return { id: `s${i}`, shape, color, at: '2026-08-19', createdAt: i };
}

describe('stampPageCount', () => {
  it('0 個でも 1 頁ある', () => {
    expect(stampPageCount(0)).toBe(1);
  });

  it('ちょうど 9 個で 2 頁目を作らない', () => {
    expect(stampPageCount(9)).toBe(1);
    expect(stampPageCount(10)).toBe(2);
  });
});

describe('stampPageSlots', () => {
  it('埋まっていなくても常に 9 枠返す', () => {
    const slots = stampPageSlots([stamp(0)], 0);
    expect(slots).toHaveLength(STAMPS_PER_PAGE);
    expect(slots[0]?.id).toBe('s0');
    expect(slots[1]).toBeNull();
  });

  it('詰めずに頁の位置どおりに返す', () => {
    const stamps = Array.from({ length: 10 }, (_, i) => stamp(i));
    expect(stampPageSlots(stamps, 1)[0]?.id).toBe('s9');
    expect(stampPageSlots(stamps, 1)[1]).toBeNull();
  });

  it('存在しない頁は空の 9 枠', () => {
    expect(stampPageSlots([], 5).every((s) => s === null)).toBe(true);
  });
});

describe('stampRotation', () => {
  it('同じ位置なら何度呼んでも同じ角度', () => {
    expect(stampRotation(3)).toBe(stampRotation(3));
  });

  it('負の位置でも表の範囲に収まる', () => {
    expect(typeof stampRotation(-1)).toBe('number');
    expect(stampRotation(-1)).not.toBeNaN();
  });
});
