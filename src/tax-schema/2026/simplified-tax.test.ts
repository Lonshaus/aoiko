import { describe, expect, test } from 'vitest';
import { DEEMED_INPUT_RATES, deemedInputRate, simplifiedTaxCategoryLabel } from './simplified-tax';

describe('DEEMED_INPUT_RATES', () => {
  test('全 6 区分が定義されている', () => {
    expect(DEEMED_INPUT_RATES[1]).toBe(0.9);
    expect(DEEMED_INPUT_RATES[2]).toBe(0.8);
    expect(DEEMED_INPUT_RATES[3]).toBe(0.7);
    expect(DEEMED_INPUT_RATES[4]).toBe(0.6);
    expect(DEEMED_INPUT_RATES[5]).toBe(0.5);
    expect(DEEMED_INPUT_RATES[6]).toBe(0.4);
  });
});

describe('deemedInputRate', () => {
  test('区分ごとの率を返す', () => {
    expect(deemedInputRate(1)).toBe(0.9);
    expect(deemedInputRate(6)).toBe(0.4);
  });
});

describe('simplifiedTaxCategoryLabel', () => {
  test('ラベル文字列を返す', () => {
    expect(simplifiedTaxCategoryLabel(1)).toContain('卸売');
    expect(simplifiedTaxCategoryLabel(3)).toContain('製造');
    expect(simplifiedTaxCategoryLabel(5)).toContain('サービス');
  });
});
