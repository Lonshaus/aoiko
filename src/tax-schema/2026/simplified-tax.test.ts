import { describe, expect, test } from 'vitest';
import { setLocale } from '../../paraglide/runtime';
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

describe('simplifiedTaxCategoryLabel の言語切替', () => {
  test('ja は従来の固定文字列と同じ', () => {
    expect(simplifiedTaxCategoryLabel(1)).toBe('第 1 種（卸売業、90%）');
    expect(simplifiedTaxCategoryLabel(2)).toBe('第 2 種（小売業・農林漁業の飲食料品譲渡、80%）');
    expect(simplifiedTaxCategoryLabel(3)).toBe('第 3 種（製造・建設・農林漁業の他、70%）');
    expect(simplifiedTaxCategoryLabel(4)).toBe('第 4 種（その他・飲食店業、60%）');
    expect(simplifiedTaxCategoryLabel(5)).toBe('第 5 種（運輸通信・金融保険・サービス業、50%）');
    expect(simplifiedTaxCategoryLabel(6)).toBe('第 6 種（不動産業、40%）');
  });

  test('en・zh-TW では日本語のままにならない', () => {
    try {
      setLocale('en', { reload: false });
      expect(simplifiedTaxCategoryLabel(1)).toBe('1st category (wholesale, 90%)');
      expect(simplifiedTaxCategoryLabel(6)).toBe('6th category (real estate, 40%)');
      setLocale('zh-TW', { reload: false });
      expect(simplifiedTaxCategoryLabel(1)).toBe('第 1 種（批發業，90%）');
      expect(simplifiedTaxCategoryLabel(6)).toBe('第 6 種（不動產業，40%）');
    } finally {
      setLocale('ja', { reload: false });
    }
  });
});
