import { describe, expect, it } from 'vitest';
import {
  STAMPS_PER_PAGE,
  STAMP_COLORS,
  STAMP_SHAPES,
  nextStampFace,
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

describe('nextStampFace', () => {
  // 押し続けたときの列を作る。random は差し替えられるので、揺らぎの検証もここでできる。
  function sequence(count: number, random: () => number): Stamp[] {
    const stamps: Stamp[] = [];
    for (let i = 0; i < count; i++) {
      const face = nextStampFace(stamps, random);
      stamps.push({
        id: `s${i}`,
        shape: face.shape,
        color: face.color,
        at: '2026-08-19',
        createdAt: i,
      });
    }
    return stamps;
  }

  it('7 個ごとに 7 種すべてが 1 回ずつ出る', () => {
    const stamps = sequence(70, Math.random);
    for (let page = 0; page < 10; page++) {
      const window = stamps.slice(page * 7, page * 7 + 7);
      expect(new Set(window.map((s) => s.shape)).size).toBe(7);
      expect(new Set(window.map((s) => s.color)).size).toBe(7);
    }
  });

  it('隣り合うスタンプが同じ絵柄・同じ色にならない', () => {
    const stamps = sequence(200, Math.random);
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i]?.shape).not.toBe(stamps[i - 1]?.shape);
      expect(stamps[i]?.color).not.toBe(stamps[i - 1]?.color);
    }
  });

  it('絵柄と色は連動しない', () => {
    // 連動していると 49 通りではなく 7 通りしか出ない。並びが一致しないことで見る。
    const stamps = sequence(70, Math.random);
    const shapeIndexes = stamps.map((s) => STAMP_SHAPES.indexOf(s.shape));
    const colorIndexes = stamps.map((s) => STAMP_COLORS.indexOf(s.color));
    expect(shapeIndexes).not.toEqual(colorIndexes);
  });

  it('random が常に 0 でも 7 種を使い切る', () => {
    // 偏った乱数でも「使い切るまで引かない」が効いていることを確かめる。
    const stamps = sequence(7, () => 0);
    expect(new Set(stamps.map((s) => s.shape)).size).toBe(7);
  });

  it('random が上限を返しても範囲外にならない', () => {
    const face = nextStampFace([], () => 0.999999);
    expect(STAMP_SHAPES).toContain(face.shape);
    expect(STAMP_COLORS).toContain(face.color);
  });

  it('空の帳面からでも引ける', () => {
    const face = nextStampFace([]);
    expect(STAMP_SHAPES).toContain(face.shape);
    expect(STAMP_COLORS).toContain(face.color);
  });
});
