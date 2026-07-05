import { describe, expect, test } from 'vitest';
import { D } from '../../lib/decimal';
import { mapSimplified } from './xtx-mapping-sha020';

describe('mapSimplified（簡易課税・単一事業区分）', () => {
  test('第5種（みなし仕入率50%）：手計算どおりの値を返す', () => {
    const result = mapSimplified({
      taxableBase10: D('2000000'),
      taxableBase8: D('0'),
      category: 5,
      deemedInputRate: 0.5,
    });
    // 課税標準額に対する消費税額 = 2000000 × 7.8% = 156000
    expect(result.shb047.DUD00020).toBe('156000');
    expect(result.sha020.ABI00020).toBe('156000');
    // 控除対象仕入税額 = 156000 × 50% = 78000
    expect(result.shb047.DUF00030).toBe('78000');
    expect(result.shb067.DVC00030).toBe('78000');
    expect(result.sha020.ABI00050).toBe('78000');
    // 差引税額（国税）= 156000 − 78000 = 78000（すでに百円単位）
    expect(result.shb047.DUH00000).toBe('78000');
    expect(result.sha020.ABI00100).toBe('78000');
    // 地方消費税額 = 78000 × 22/78 = 22000
    expect(result.shb047.DUJ00020).toBe('22000');
    expect(result.sha020.ABJ00060).toBe('22000');
    // 合計 = 78000 + 22000 = 100000
    expect(result.sha020.ABJ00130).toBe('100000');
  });

  test('事業区分は付表5-3の区分（kubun）に raw で立ち、SHA020 の該当種の課税売上高欄に転記される', () => {
    const result = mapSimplified({
      taxableBase10: D('2000000'),
      taxableBase8: D('0'),
      category: 5,
      deemedInputRate: 0.5,
    });
    expect(result.shb067Raw.DVC00010).toBe('<kubun_CD>5</kubun_CD>');
    expect(result.sha020.ABL00160).toBe('2000000');
    expect(result.sha020.ABL00040).toBeUndefined();
  });

  test('第1種（みなし仕入率90%）は別の欄（ABL00040）に課税売上高が転記される', () => {
    const result = mapSimplified({
      taxableBase10: D('1000000'),
      taxableBase8: D('0'),
      category: 1,
      deemedInputRate: 0.9,
    });
    expect(result.shb067Raw.DVC00010).toBe('<kubun_CD>1</kubun_CD>');
    expect(result.sha020.ABL00040).toBe('1000000');
  });

  test('標準税率・軽減税率が混在する場合、税率ごとに計算する', () => {
    const result = mapSimplified({
      taxableBase10: D('1000000'),
      taxableBase8: D('500000'),
      category: 2,
      deemedInputRate: 0.8,
    });
    // 10%分：1000000×7.8%=78000、8%分：500000×6.24%=31200
    expect(result.shb047.DUD00010).toBe('31200');
    expect(result.shb047.DUD00020).toBe('78000');
    expect(result.shb047.DUD00030).toBe('109200');
  });
});