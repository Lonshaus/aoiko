import { describe, expect, test } from 'vitest';
import { D } from '../../lib/decimal';
import { mapSimplified, mapTwoWari } from './xtx-mapping-sha020';

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
    const result = mapTwoWari({
      taxableBase10: D('1000000'),
      taxableBase8: D('0'),
      ...zeroExtras(),
    });
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

  test('D3-F5：売上対価の返還等（7.8%分10,000）を付表6・ABI00060へ転記し、基数から差し引く', () => {
    const result = mapTwoWari({
      taxableBase10: D('1000000'),
      taxableBase8: D('0'),
      salesReturnTax78: D('10000'),
      ...zeroExtras(),
    });
    expect(result.shb070.AYB00190).toBe('10000');
    expect(result.shb070.AYB00200).toBe('10000');
    expect(result.shb070.AYB00180).toBeUndefined();
    // 78,000 − 10,000 = 68,000
    expect(result.shb070.AYB00230).toBe('68000');
    // 68,000 × 80% = 54,400
    expect(result.shb070.AYC00030).toBe('54400');
    expect(result.sha020.ABI00060).toBe('10000');
    // 控除税額小計 = 54,400（控除対象仕入税額）+ 10,000（返還等）= 64,400
    expect(result.sha020.ABI00080).toBe('64400');
    // 差引税額 = 78,000 − 64,400 = 13,600（未入力時は15,600）
    expect(result.sha020.ABI00100).toBe('13600');
    expect(result.sha020.ABT00000).toBe('10000');
    expect(result.sha020.ABU00010).toBe('10000');
  });

  test('D3-F5：未入力時は返還等関連欄が出力されず、差引税額は15,600のまま（回帰）', () => {
    const result = mapTwoWari({
      taxableBase10: D('1000000'),
      taxableBase8: D('0'),
      ...zeroExtras(),
    });
    expect(result.shb070.AYB00180).toBeUndefined();
    expect(result.shb070.AYB00190).toBeUndefined();
    expect(result.sha020.ABI00060).toBeUndefined();
    expect(result.sha020.ABI00100).toBe('15600');
  });

  test('D3-F5：両税率とも返還等があれば各税率欄に個別に転記される', () => {
    const result = mapTwoWari({
      taxableBase10: D('1000000'),
      taxableBase8: D('500000'),
      salesReturnTax78: D('5000'),
      salesReturnTax624: D('3000'),
      ...zeroExtras(),
    });
    expect(result.shb070.AYB00190).toBe('5000');
    expect(result.shb070.AYB00180).toBe('3000');
    expect(result.shb070.AYB00200).toBe('8000');
  });
});

describe('mapSimplified（簡易課税）', () => {
  function zeroExtras() {
    return {
      badDebtTax10: D('0'),
      badDebtTax8: D('0'),
      badDebtRecoveryTax10: D('0'),
      badDebtRecoveryTax8: D('0'),
    };
  }

  test('D3-F8(a)：印の付いた行（第四種）ありの兼業計算。第五種＋第四種のいずれも分列される', () => {
    const result = mapSimplified({
      taxableBase10: D('10100000'),
      taxableBase8: D('0'),
      category: 5,
      deemedInputRate: 0.5,
      markedTransferBase10: D('100000'),
      markedTransferBase8: D('0'),
      ...zeroExtras(),
    });
    // 付表5-3 (1) の明細：⑥合計・設定区分（第五種）と第四種の課税売上高（税抜き）と売上割合
    expect(result.shb067.DVD00040).toBe('10100000');
    expect(result.shb067.DVD00050).toBe('10100000');
    expect(result.shb067.DVD00320).toBe('10000000');
    expect(result.shb067.DVD00340).toBe('10000000');
    expect(result.shb067.DVD00350).toBe('99');
    expect(result.shb067.DVD00260).toBe('100000');
    expect(result.shb067.DVD00280).toBe('100000');
    expect(result.shb067.DVD00290).toBe('0.9');
    // ABL00210「特例計算適用」：特例（393,900）ではなく原則（394,680）が採用されたので立たない
    expect(result.sha020Raw.ABL00210).toBeUndefined();
    // 付表5-3 (2) の明細：第五種（780,000）と第四種（7,800）が別欄に出る
    expect(result.shb067.DVD00650).toBe('780000');
    expect(result.shb067.DVD00610).toBe('7800');
    // 原則＝394,680、特例（単一区分75%以上）＝393,900、採用は大きい方の394,680
    expect(result.shb067.DVE00030).toBe('394680');
    expect(result.shb067.DVE00090).toBe('393900');
    expect(result.shb067.DVE00740).toBe('394680');
    expect(result.shb067Raw.DVE00070).toBe('<kubun_CD>5</kubun_CD>');
    // SHA020 第一表：設定区分（第五種）と第四種の課税売上高が分けて出る
    expect(result.sha020.ABL00160).toBe('10000000');
    expect(result.sha020.ABL00130).toBe('100000');
  });

  test('D3-F8(b)：設定区分第一種の兼業。特例（709,020）が原則（706,680）より大きく採用される', () => {
    const result = mapSimplified({
      taxableBase10: D('10100000'),
      taxableBase8: D('0'),
      category: 1,
      deemedInputRate: 0.9,
      markedTransferBase10: D('100000'),
      markedTransferBase8: D('0'),
      ...zeroExtras(),
    });
    expect(result.shb067.DVE00040).toBe('706680');
    expect(result.shb067.DVE00100).toBe('709020');
    expect(result.shb067.DVE00750).toBe('709020');
    expect(result.shb067Raw.DVE00070).toBe('<kubun_CD>1</kubun_CD>');
    // (1) の明細：設定区分（第一種）の欄に振り分けられる
    expect(result.shb067.DVD00080).toBe('10000000');
    expect(result.shb067.DVD00100).toBe('10000000');
    expect(result.shb067.DVD00110).toBe('99');
    // ABL00210：特例（709,020）が原則（706,680）より大きく採用されたので立つ
    expect(result.sha020Raw.ABL00210).toBe('<kubun_CD>1</kubun_CD>');
  });

  test('D3-F8(c)：R（回帰）印の付いた行が無ければ単一区分の従来経路（DVC）のまま', () => {
    const result = mapSimplified({
      taxableBase10: D('10000000'),
      taxableBase8: D('0'),
      category: 5,
      deemedInputRate: 0.5,
      ...zeroExtras(),
    });
    expect(result.shb067.DVC00030).toBe('390000');
    expect(result.shb067Raw.DVC00010).toBe('<kubun_CD>5</kubun_CD>');
    expect(result.shb067.DVE00020).toBeUndefined();
    expect(result.shb067.DVD00030).toBeUndefined();
    expect(result.sha020Raw.ABL00210).toBeUndefined();
  });
});
