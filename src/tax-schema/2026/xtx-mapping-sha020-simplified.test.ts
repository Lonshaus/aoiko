import { describe, expect, test } from 'vitest';
import { D } from '../../lib/decimal';
import { mapSimplified } from './xtx-mapping-sha020';

function zeroExtras() {
  return {
    badDebtTax10: D('0'),
    badDebtTax8: D('0'),
    badDebtRecoveryTax10: D('0'),
    badDebtRecoveryTax8: D('0'),
  };
}

describe('mapSimplified（簡易課税・単一事業区分）', () => {
  test('第5種（みなし仕入率50%）：手計算どおりの値を返す', () => {
    const result = mapSimplified({
      taxableBase10: D('2000000'),
      taxableBase8: D('0'),
      category: 5,
      deemedInputRate: 0.5,
      ...zeroExtras(),
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
      ...zeroExtras(),
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
      ...zeroExtras(),
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
      ...zeroExtras(),
    });
    // 10%分：1000000×7.8%=78000、8%分：500000×6.24%=31200
    expect(result.shb047.DUD00010).toBe('31200');
    expect(result.shb047.DUD00020).toBe('78000');
    expect(result.shb047.DUD00030).toBe('109200');
  });

  test('貸倒回収はみなし仕入率の計算の基礎にも算入され、貸倒れは別枠で減算される', () => {
    const result = mapSimplified({
      taxableBase10: D('1000000'),
      taxableBase8: D('0'),
      category: 5,
      deemedInputRate: 0.5,
      ...zeroExtras(),
      badDebtTax10: D('780'),
      badDebtRecoveryTax10: D('1000'),
    });
    // 課税標準額に対する消費税額 = 78,000。基準消費税額 = 78,000 + 1,000 = 79,000 → ×50% = 39,500
    expect(result.shb047.DUF00030).toBe('39500');
    expect(result.sha020.ABI00050).toBe('39500');
    expect(result.sha020.ABI00030).toBe('1000');
    expect(result.sha020.ABI00070).toBe('780');
    // 控除税額小計 = 39,500 + 780 = 40,280
    expect(result.sha020.ABI00080).toBe('40280');
  });

  test('interimPeriod を指定すると ABH00160 に中間申告の対象期間が raw で立つ', () => {
    const result = mapSimplified({
      taxableBase10: D('1000000'),
      taxableBase8: D('0'),
      category: 5,
      deemedInputRate: 0.5,
      ...zeroExtras(),
      interimPeriod: { start: '2026-07-01', end: '2026-09-30' },
    });
    expect(result.sha020Raw.ABH00160).toBe(
      '<ABH00170><gen:era>5</gen:era><gen:yy>8</gen:yy><gen:mm>7</gen:mm><gen:dd>1</gen:dd></ABH00170>' +
        '<ABH00180><gen:era>5</gen:era><gen:yy>8</gen:yy><gen:mm>9</gen:mm><gen:dd>30</gen:dd></ABH00180>',
    );
  });

  test('貸倒れ税額が控除税額小計を上回る還付:差引欄でなく控除不足還付欄へ正値', () => {
    const result = mapSimplified({
      taxableBase10: D('1000000'),
      taxableBase8: D('0'),
      category: 5,
      deemedInputRate: 0.5,
      ...zeroExtras(),
      badDebtTax10: D('100000'),
    });
    // 売上税額 78000 −（みなし仕入 39000 ＋ 貸倒れ 100000）= −61000 → 控除不足還付 61000
    expect(result.sha020.ABI00090).toBe('61000');
    expect(result.sha020.ABI00100).toBeUndefined();
    expect(result.sha020.ABI00120).toBeUndefined();
    // 地方：課税標準となる消費税額・譲渡割額とも還付欄へ
    expect(result.sha020.ABJ00020).toBe('61000');
    expect(result.sha020.ABJ00030).toBeUndefined();
    // 譲渡割額 = 61000 × 22/78 = 17205.1… → 百円未満切り捨て 17200 を還付額へ
    expect(result.sha020.ABJ00050).toBe('17200');
    expect(result.sha020.ABJ00060).toBeUndefined();
    expect(result.sha020.ABJ00080).toBeUndefined();
    // 合計（納付又は還付）は符号付き純額（負＝還付）
    expect(result.sha020.ABJ00130).toBe('-78200');
    // 付表4-3 も同様に控除不足還付欄へ
    expect(result.shb047.DUG00000).toBe('61000');
    expect(result.shb047.DUH00000).toBeUndefined();
    expect(result.shb047.DUI00010).toBe('61000');
    expect(result.shb047.DUI00020).toBeUndefined();
    expect(result.shb047.DUJ00010).toBe('17200');
    expect(result.shb047.DUJ00020).toBeUndefined();
  });

  test('本年中の中間納付税額を確定申告の差引税額に充当する', () => {
    const result = mapSimplified({
      taxableBase10: D('2000000'),
      taxableBase8: D('0'),
      category: 5,
      deemedInputRate: 0.5,
      ...zeroExtras(),
      interimPaidNational: D('30000'),
      interimPaidLocal: D('5000'),
    });
    // 差引税額（国税）= 78000、中間納付済30000 → 納付税額 48000
    expect(result.sha020.ABI00100).toBe('78000');
    expect(result.sha020.ABI00110).toBe('30000');
    expect(result.sha020.ABI00120).toBe('48000');
    // 地方消費税額 22000、中間納付済5000 → 納付譲渡割額 17000
    expect(result.sha020.ABJ00060).toBe('22000');
    expect(result.sha020.ABJ00070).toBe('5000');
    expect(result.sha020.ABJ00080).toBe('17000');
    expect(result.sha020.ABJ00130).toBe('65000');
  });
});
