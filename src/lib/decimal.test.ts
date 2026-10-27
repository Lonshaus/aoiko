import { describe, expect, test } from 'vitest';
import { AmountTooLargeError, D, formatJPY, toAmountString, toIndexable } from './decimal';

describe('toIndexable', () => {
  test('zero', () => {
    expect(toIndexable(0)).toBe('00000000000000.00');
  });

  test('integer', () => {
    expect(toIndexable(12345)).toBe('00000000012345.00');
  });

  test('decimal value', () => {
    expect(toIndexable('12345.67')).toBe('00000000012345.67');
  });

  test('preserves order lexicographically', () => {
    expect(toIndexable(100) < toIndexable(1000)).toBe(true);
    expect(toIndexable(999) < toIndexable(1000)).toBe(true);
    expect(toIndexable('0.5') < toIndexable(1)).toBe(true);
  });

  test('max range 14 integer digits', () => {
    expect(toIndexable('99999999999999.99')).toBe('99999999999999.99');
  });

  test('14 桁を超える値と進位で 15 桁になる値は AmountTooLargeError', () => {
    expect(() => toIndexable('100000000000000')).toThrow(AmountTooLargeError);
    expect(() => toIndexable('99999999999999.995')).toThrow(AmountTooLargeError);
    expect(() => toIndexable('Infinity')).toThrow(AmountTooLargeError);
    expect(() => toIndexable('NaN')).toThrow(AmountTooLargeError);
  });

  test('極端な指数でも 1 秒以内に投げる', () => {
    const start = Date.now();
    expect(() => toIndexable('1e9000000000000000')).toThrow(AmountTooLargeError);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  test('rejects negative', () => {
    expect(() => toIndexable(-1)).toThrow(/negative/);
    expect(() => toIndexable('-0.01')).toThrow(/negative/);
  });

  test('round-trip via D', () => {
    const values = ['0', '1', '12345', '12345.67', '0.01'];
    for (const v of values) {
      const idx = toIndexable(v);
      expect(D(idx).toString()).toBe(D(v).toString());
    }
  });
});

describe('formatJPY', () => {
  test('zero', () => {
    expect(formatJPY(0)).toBe('¥0');
  });

  test('thousands separator', () => {
    expect(formatJPY(1234567)).toBe('¥1,234,567');
  });

  test('rounds fractional to integer', () => {
    expect(formatJPY('12345.67')).toBe('¥12,346');
  });

  test('negative', () => {
    expect(formatJPY(-5000)).toBe('-¥5,000');
  });

  test('accepts Decimal instance', () => {
    expect(formatJPY(D('98765'))).toBe('¥98,765');
  });
});

describe('toAmountString', () => {
  test('一般の値は toFixed と同じ（指数表記にならない）', () => {
    expect(toAmountString(D('1000'))).toBe('1000');
    expect(toAmountString(D('1e21'))).toBe('1000000000000000000000');
    expect(toAmountString(D('0.0000001'))).toBe('0.0000001');
    expect(toAmountString(D(0))).toBe('0');
  });

  test('有限でない値と指数が範囲外の値は AmountTooLargeError', () => {
    for (const v of ['NaN', 'Infinity', '-Infinity', '1e1001', '1e-1001']) {
      expect(() => toAmountString(D(v)), v).toThrow(AmountTooLargeError);
    }
  });

  test('極端な指数でも即座に投げる', () => {
    const start = Date.now();
    expect(() => toAmountString(D('1e-9000000000000000'))).toThrow(AmountTooLargeError);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
