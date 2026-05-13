import { describe, expect, test } from 'vitest';
import {
  TRANSITIONAL_BOUNDARY_2026_10,
  TRANSITIONAL_BOUNDARY_2028_10,
  TRANSITIONAL_BOUNDARY_2030_10,
  TRANSITIONAL_BOUNDARY_2031_10,
  transitionalCreditRate,
  transitionalPeriodLabel,
} from './invoice-transitional';

describe('transitionalCreditRate', () => {
  test('2023/10〜2026/9 → 80%', () => {
    expect(transitionalCreditRate('2024-01-01')).toBe(0.8);
    expect(transitionalCreditRate('2025-12-31')).toBe(0.8);
    expect(transitionalCreditRate('2026-09-30')).toBe(0.8);
  });

  test('2026/10/01 で 70% へ切替', () => {
    expect(transitionalCreditRate(TRANSITIONAL_BOUNDARY_2026_10)).toBe(0.7);
    expect(transitionalCreditRate('2026-10-01')).toBe(0.7);
    expect(transitionalCreditRate('2027-06-15')).toBe(0.7);
    expect(transitionalCreditRate('2028-09-30')).toBe(0.7);
  });

  test('2028/10/01 で 50% へ切替', () => {
    expect(transitionalCreditRate(TRANSITIONAL_BOUNDARY_2028_10)).toBe(0.5);
    expect(transitionalCreditRate('2029-01-01')).toBe(0.5);
    expect(transitionalCreditRate('2030-09-30')).toBe(0.5);
  });

  test('2030/10/01 で 30% へ切替', () => {
    expect(transitionalCreditRate(TRANSITIONAL_BOUNDARY_2030_10)).toBe(0.3);
    expect(transitionalCreditRate('2031-01-01')).toBe(0.3);
    expect(transitionalCreditRate('2031-09-30')).toBe(0.3);
  });

  test('2031/10/01 以降 → 0%（完全廃止）', () => {
    expect(transitionalCreditRate(TRANSITIONAL_BOUNDARY_2031_10)).toBe(0);
    expect(transitionalCreditRate('2031-10-01')).toBe(0);
    expect(transitionalCreditRate('2099-12-31')).toBe(0);
  });
});

describe('transitionalPeriodLabel', () => {
  test('各期間の正しいラベル', () => {
    expect(transitionalPeriodLabel('2025-06-01')).toBe('80%（2023/10〜2026/9）');
    expect(transitionalPeriodLabel('2027-03-15')).toBe('70%（2026/10〜2028/9）');
    expect(transitionalPeriodLabel('2029-11-30')).toBe('50%（2028/10〜2030/9）');
    expect(transitionalPeriodLabel('2031-06-01')).toBe('30%（2030/10〜2031/9）');
    expect(transitionalPeriodLabel('2032-01-01')).toBe('0%（2031/10〜、適用外）');
  });
});