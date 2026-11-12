import { describe, expect, test } from 'vitest';
import { initialProcessingYear, isProcessingYear } from './initial-processing-year';

describe('initialProcessingYear', () => {
  test('当地時間の 2026-12-31 は 2026', () => {
    expect(initialProcessingYear(new Date(2026, 11, 31, 23, 59, 59))).toBe(2026);
  });

  test('当地時間の 2027-01-01 は 2027', () => {
    expect(initialProcessingYear(new Date(2027, 0, 1, 0, 0, 0))).toBe(2027);
  });

  test('範囲外の年は範囲内へ収め、無効な日時は 2020', () => {
    expect(initialProcessingYear(new Date(1970, 0, 1))).toBe(2020);
    expect(initialProcessingYear(new Date(2150, 0, 1))).toBe(2099);
    expect(initialProcessingYear(new Date(NaN))).toBe(2020);
  });
});

describe('isProcessingYear', () => {
  test.each([2020, 2099, 2026])('%s は処理年度', (v) => {
    expect(isProcessingYear(v)).toBe(true);
  });

  test.each([2019, 2100, 0, -1, 1e300, 2026.5, '2026', null, NaN])('%s は処理年度ではない', (v) => {
    expect(isProcessingYear(v)).toBe(false);
  });
});
