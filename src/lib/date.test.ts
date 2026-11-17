import { describe, expect, test } from 'vitest';
import { isValidIsoDate, toISODateLocal, todayISO } from './date';

describe('toISODateLocal', () => {
  test('ローカル日付を YYYY-MM-DD に整形する', () => {
    expect(toISODateLocal(new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(toISODateLocal(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  test('月と日を 2 桁にそろえる', () => {
    expect(toISODateLocal(new Date(2026, 4, 5))).toBe('2026-05-05');
  });

  test('UTC ではなくローカル時刻を使う（JST の深夜でも前日にならない）', () => {
    // ローカル 2026-01-01 00:30 は UTC 変換だと前年 12/31 になりうるが、ローカル日付を返す
    const d = new Date(2026, 0, 1, 0, 30);
    expect(toISODateLocal(d)).toBe('2026-01-01');
  });
});

describe('todayISO', () => {
  test('ローカルの現在時刻に合う YYYY-MM-DD 形式を返す', () => {
    const now = new Date();
    expect(todayISO()).toBe(toISODateLocal(now));
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('isValidIsoDate', () => {
  test.each(['2026-01-01', '2024-02-29', '2026-12-31'])('%j は実在する日付', (v) => {
    expect(isValidIsoDate(v)).toBe(true);
  });

  test.each(['2026-13-01', '2026/12/31', '2025-02-29', '2026-1-1', '', 'abc', 20260101, null])(
    '%j は日付として読めない',
    (v) => {
      expect(isValidIsoDate(v)).toBe(false);
    },
  );
});
