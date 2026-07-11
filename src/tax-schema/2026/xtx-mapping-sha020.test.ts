import { describe, expect, test } from 'vitest';
import { D } from '../../lib/decimal';
import { mapTwoWari } from './xtx-mapping-sha020';

function zeroExtras() {
  return {
    badDebtTax10: D('0'),
    badDebtTax8: D('0'),
    badDebtRecoveryTax10: D('0'),
    badDebtRecoveryTax8: D('0'),
  };
}

describe('mapTwoWari（2割特例）', () => {
  test('標準税率のみ：手計算どおりの値を返す', () => {
    const result = mapTwoWari({
      taxableBase10: D('6008481'),
      taxableBase8: D('0'),
      ...zeroExtras(),
    });
    // Step2 課税標準額 = 6008481 → 千円未満切り捨て = 6008000
    expect(result.shb070.AYB00070).toBe('6008000');
    expect(result.sha020.ABI00010).toBe('6008000');
    // Step3 消費税額 = 6008000 × 7.8% = 468624
    expect(result.shb070.AYB00110).toBe('468624');
    expect(result.sha020.ABI00020).toBe('468624');
    // Step6 特別控除税額 = 468624 × 80% = 374899（1円未満切り捨て）
    expect(result.shb070.AYC00030).toBe('374899');
    expect(result.sha020.ABI00050).toBe('374899');
    expect(result.sha020.ABI00080).toBe('374899');
    // 差引税額（国税）= 468624 − 374899 = 93725 → 百円未満切り捨て = 93700
    expect(result.sha020.ABI00100).toBe('93700');
    expect(result.sha020.ABI00120).toBe('93700');
    // 地方消費税額 = 93700 × 22/78 = 26428.2… → 百円未満切り捨て = 26400
    expect(result.sha020.ABJ00060).toBe('26400');
    expect(result.sha020.ABJ00080).toBe('26400');
    // 合計 = 93700 + 26400 = 120100
    expect(result.sha020.ABJ00130).toBe('120100');
  });

  test('標準税率・軽減税率が混在する場合、税率ごとに計算する', () => {
    const result = mapTwoWari({
      taxableBase10: D('1000000'),
      taxableBase8: D('500000'),
      ...zeroExtras(),
    });
    // 10%分：課税標準額1000000×7.8%=78000
    expect(result.shb070.AYB00070).toBe('1000000');
    expect(result.shb070.AYB00110).toBe('78000');
    // 8%分：課税標準額500000×6.24%=31200
    expect(result.shb070.AYB00060).toBe('500000');
    expect(result.shb070.AYB00100).toBe('31200');
    // 合計消費税額 = 78000+31200 = 109200
    expect(result.shb070.AYB00120).toBe('109200');
    expect(result.sha020.ABI00020).toBe('109200');
  });

  test('2割特例チェック欄（ABY00000）が raw で立つ', () => {
    const result = mapTwoWari({ taxableBase10: D('1000000'), taxableBase8: D('0'), ...zeroExtras() });
    expect(result.sha020Raw.ABY00000).toBe('<kubun_CD>1</kubun_CD>');
  });

  test('課税売上が無ければ税額は0（フィールド自体を出力しない）', () => {
    const result = mapTwoWari({ taxableBase10: D('0'), taxableBase8: D('0'), ...zeroExtras() });
    expect(result.sha020.ABI00010).toBeUndefined();
    expect(result.sha020.ABI00020).toBeUndefined();
  });

  test('貸倒回収は特別控除税額の基礎にも算入され、貸倒れは別枠で減算される', () => {
    const result = mapTwoWari({
      taxableBase10: D('1000000'),
      taxableBase8: D('0'),
      ...zeroExtras(),
      badDebtTax10: D('780'),
      badDebtRecoveryTax10: D('1000'),
    });
    // 課税標準額に対する消費税額 = 78,000。特別控除の基礎 = 78,000 + 1,000 = 79,000 → ×80% = 63,200
    expect(result.shb070.AYC00030).toBe('63200');
    expect(result.sha020.ABI00050).toBe('63200');
    expect(result.sha020.ABI00030).toBe('1000');
    expect(result.sha020.ABI00070).toBe('780');
    // 控除税額小計 = 63,200 + 780 = 63,980
    expect(result.sha020.ABI00080).toBe('63980');
  });

  test('本年中の中間納付税額を確定申告の差引税額に充当する', () => {
    const result = mapTwoWari({
      taxableBase10: D('6008481'),
      taxableBase8: D('0'),
      ...zeroExtras(),
      interimPaidNational: D('50000'),
      interimPaidLocal: D('10000'),
    });
    // 差引税額（国税）= 93700、中間納付済50000 → 納付税額 43700
    expect(result.sha020.ABI00100).toBe('93700');
    expect(result.sha020.ABI00110).toBe('50000');
    expect(result.sha020.ABI00120).toBe('43700');
    // 地方消費税額 26400、中間納付済10000 → 納付譲渡割額 16400
    expect(result.sha020.ABJ00060).toBe('26400');
    expect(result.sha020.ABJ00070).toBe('10000');
    expect(result.sha020.ABJ00080).toBe('16400');
    expect(result.sha020.ABJ00130).toBe('60100');
  });
});