import { describe, expect, test } from 'vitest';
import { businessMonthsInYear, smallAssetAnnualCap } from './limits';

describe('年ごとの開業日と廃業日による業務期間の月数（措法28の2第1項後段）', () => {
  test('同じ年に廃業 3/31・再開業 7/1 は 1〜3 月と 7〜12 月の 9 か月', () => {
    expect(businessMonthsInYear(2026, ['2026-07-01'], '2026-03-31')).toBe(9);
    expect(smallAssetAnnualCap(2026, ['2026-07-01'], '2026-03-31').toString()).toBe('2250000');
  });

  test('開業 7/1・廃業 8/31 は 2 か月', () => {
    expect(businessMonthsInYear(2026, ['2026-07-01'], '2026-08-31')).toBe(2);
  });

  test('廃業と開業が別の年なら、それぞれの年で月割する', () => {
    const starts = ['2026-07-01'];
    expect(businessMonthsInYear(2024, starts, '2024-03-31')).toBe(3);
    expect(businessMonthsInYear(2026, starts, '2024-03-31')).toBe(6);
    expect(businessMonthsInYear(2025, starts, '2024-03-31')).toBe(12);
  });

  test('年ごとの開業日は、その年のものだけを使い、同じ年に複数あれば最も早い日', () => {
    const starts = ['2023-05-01', '2026-09-15', '2026-07-01'];
    expect(businessMonthsInYear(2023, starts)).toBe(8);
    expect(businessMonthsInYear(2026, starts)).toBe(6);
    expect(businessMonthsInYear(2024, starts)).toBe(12);
  });

  test('廃業日が開業日より前の合計は 12 か月を超えない', () => {
    expect(businessMonthsInYear(2026, ['2026-02-01'], '2026-01-31')).toBe(12);
    expect(businessMonthsInYear(2026, ['2026-01-15'], '2026-01-10')).toBe(12);
    expect(businessMonthsInYear(2026, ['2026-12-31'], '2026-01-01')).toBe(2);
  });
});
