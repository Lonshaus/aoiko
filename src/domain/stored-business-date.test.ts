import { describe, expect, it } from 'vitest';
import { readStoredBusinessDate, sameStoredBusinessDate } from './stored-business-date';

describe('readStoredBusinessDate', () => {
  it.each([undefined, null, ''])('%j は未設定として undefined', (value) => {
    expect(readStoredBusinessDate(value)).toBeUndefined();
  });

  it('日付として読める文字列は valid: true', () => {
    expect(readStoredBusinessDate('2026-04-01')).toEqual({ value: '2026-04-01', valid: true });
  });

  it('存在しない日付・文字列でない値は valid: false で元の値を保つ', () => {
    expect(readStoredBusinessDate('2026-02-30')).toEqual({ value: '2026-02-30', valid: false });
    expect(readStoredBusinessDate(20260401)).toEqual({ value: 20260401, valid: false });
  });
});

describe('sameStoredBusinessDate', () => {
  it('同じ日付の文字列は同じ', () => {
    expect(sameStoredBusinessDate('2026-04-01', '2026-04-01')).toBe(true);
  });

  it('空値と undefined は同じ', () => {
    expect(sameStoredBusinessDate('', undefined)).toBe(true);
    expect(sameStoredBusinessDate(null, undefined)).toBe(true);
  });

  it('中身が同じ別の配列は同じ', () => {
    expect(sameStoredBusinessDate(['2026-04-01'], ['2026-04-01'])).toBe(true);
  });

  it('違う日付は違う', () => {
    expect(sameStoredBusinessDate('2026-04-01', '2026-04-02')).toBe(false);
    expect(sameStoredBusinessDate('2026-04-01', undefined)).toBe(false);
  });
});
