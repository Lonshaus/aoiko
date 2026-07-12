import { describe, expect, test } from 'vitest';
import { D } from '../../lib/decimal';
import { mapGeneral } from './xtx-mapping-sha010';

// 課税売上割合100%（免税・非課税売上なし）を前提とするテスト用の既定値
function zeroExtras() {
  return {
    exportExemptSalesBase: D('0'),
    nonTaxableSalesBase: D('0'),
    inputCommon10: D('0'),
    inputCommon8: D('0'),
    inputNonTaxableOnly10: D('0'),
    inputNonTaxableOnly8: D('0'),
    importTax10: D('0'),
    importTax8: D('0'),
    reverseChargeBase: D('0'),
    reverseChargeTax: D('0'),
    reverseChargeCommonTax: D('0'),
    reverseChargeNonTaxableOnlyTax: D('0'),
    attributionMethod: 'proportional' as const,
    badDebtTax10: D('0'),
    badDebtTax8: D('0'),
    badDebtRecoveryTax10: D('0'),
    badDebtRecoveryTax8: D('0'),
  };
}

describe('mapGeneral（本則課税）', () => {
  test('標準税率のみ：手計算どおりの値を返す', () => {
    const result = mapGeneral({
      taxableBase10: D('3000000'),
      taxableBase8: D('0'),
      input10: D('100000'),
      input8: D('0'),
      ...zeroExtras(),
    });
    // 課税標準額 = 3000000（すでに千円単位）
    expect(result.shb017.DSB00020).toBe('3000000');
    expect(result.sha010.AAJ00010).toBe('3000000');
    // 消費税額 = 3000000 × 7.8% = 234000
    expect(result.shb017.DSD00020).toBe('234000');
    expect(result.sha010.AAJ00020).toBe('234000');
    // 控除対象仕入税額 = 100000（実額をそのまま転記）
    expect(result.shb017.DSF00030).toBe('100000');
    expect(result.sha010.AAJ00050).toBe('100000');
    // 差引税額（国税）= 234000 − 100000 = 134000（すでに百円単位）
    expect(result.shb017.DSH00000).toBe('134000');
    expect(result.sha010.AAJ00100).toBe('134000');
    // 地方消費税額 = 134000 × 22/78 = 37794.87… → 百円未満切り捨て = 37700
    expect(result.shb017.DSJ00020).toBe('37700');
    expect(result.sha010.AAJ00120).toBe('134000');
  });

  test('付表2-3 は課税売上割合100%（全額控除）区分のみ使用する', () => {
    const result = mapGeneral({
      taxableBase10: D('1000000'),
      taxableBase8: D('0'),
      input10: D('50000'),
      input8: D('0'),
      ...zeroExtras(),
    });
    expect(result.shb033.DTD00000).toBe('100.00');
    expect(result.shb033.DTF00020).toBe('50000');
  });

  test('標準税率・軽減税率が混在する場合、税率ごとに計算する', () => {
    const result = mapGeneral({
      taxableBase10: D('1000000'),
      taxableBase8: D('500000'),
      input10: D('30000'),
      input8: D('10000'),
      ...zeroExtras(),
    });
    // 10%分：課税標準額1000000×7.8%=78000、8%分：500000×6.24%=31200
    expect(result.shb017.DSD00020).toBe('78000');
    expect(result.shb017.DSD00010).toBe('31200');
    expect(result.shb017.DSD00030).toBe('109200');
    expect(result.shb017.DSF00030).toBe('30000');
    expect(result.shb017.DSF00020).toBe('10000');
    expect(result.shb017.DSF00040).toBe('40000');
  });

  test('経過措置控除率適用後の仕入税額（小数）は1円未満切り捨てで転記する', () => {
    const result = mapGeneral({
      taxableBase10: D('1000000'),
      taxableBase8: D('0'),
      input10: D('62.4'),
      input8: D('0'),
      ...zeroExtras(),
    });
    expect(result.shb017.DSF00030).toBe('62');
  });

  test('免税売上・非課税売上・輸入消費税・リバースチャージが付表2-3に転記される', () => {
    const result = mapGeneral({
      taxableBase10: D('1000000'),
      taxableBase8: D('0'),
      input10: D('50000'),
      input8: D('0'),
      ...zeroExtras(),
      exportExemptSalesBase: D('200000'),
      nonTaxableSalesBase: D('100000'),
      importTax10: D('3000'),
      reverseChargeBase: D('50000'),
      reverseChargeTax: D('3900'),
    });
    expect(result.shb033.DTB00050).toBe('200000');
    expect(result.shb033.DTC00020).toBe('100000');
    // 課税売上割合 = (1,000,000+200,000) / (1,000,000+200,000+100,000) = 1,200,000/1,300,000 ≒ 92.30%
    expect(result.shb033.DTD00000).toBe('92.30');
    expect(result.shb033.DTE00170).toBe('3000');
    expect(result.shb033.DTE00110).toBe('50000');
    expect(result.shb033.DTE00140).toBe('3900');
    // 95%未満のため DTF ではなく DTG（一括比例配分方式・既定）に転記される
    expect(result.shb033.DTF00020).toBeUndefined();
    expect(result.shb033.DTG00170).toBeDefined();
  });

  test('個別対応方式を指定すると DTG00010系（用途区分別内訳）に転記される', () => {
    const result = mapGeneral({
      taxableBase10: D('1000000'),
      taxableBase8: D('0'),
      input10: D('50000'),
      input8: D('0'),
      ...zeroExtras(),
      nonTaxableSalesBase: D('100000'),
      inputCommon10: D('10000'),
      attributionMethod: 'individual',
    });
    expect(result.shb033.DTG00080).toBe('10000');
    expect(result.shb033.DTG00040).toBe('40000');
    expect(result.shb033.DTG00130).toBeDefined();
  });

  test('貸倒れ税額は AAJ00070 に、貸倒回収は AAJ00030 に転記され、控除税額小計に反映される', () => {
    const result = mapGeneral({
      taxableBase10: D('1000000'),
      taxableBase8: D('0'),
      input10: D('50000'),
      input8: D('0'),
      ...zeroExtras(),
      badDebtTax10: D('780'),
      badDebtRecoveryTax8: D('624'),
    });
    expect(result.sha010.AAJ00070).toBe('780');
    expect(result.sha010.AAJ00030).toBe('624');
    // 控除税額小計 = 50,000（仕入税額控除）＋ 780（貸倒れ）= 50,780
    expect(result.sha010.AAJ00080).toBe('50780');
    expect(result.shb017.DSF00190).toBe('780');
    expect(result.shb017.DSE00010).toBe('624');
    expect(result.shb033.DTJ00010).toBe('624');
  });

  test('特定課税仕入れ適用（割合95%未満）：課税標準・控除・第二表内訳が対称に配線される', () => {
    const result = mapGeneral({
      taxableBase10: D('1000000'),
      taxableBase8: D('0'),
      input10: D('0'),
      input8: D('0'),
      ...zeroExtras(),
      nonTaxableSalesBase: D('100000'),
      reverseChargeBase: D('100000'),
      reverseChargeTax: D('7800'),
    });
    // 課税標準額（7.8%）= 合算後千円未満切捨て floor1000(1,000,000 + 100,000) = 1,100,000
    expect(result.shb017.DSB00020).toBe('1100000');
    expect(result.shb017.DSD00020).toBe('85800');
    // (1)の内訳：課税資産の譲渡等の対価（生値）と特定課税仕入れの対価を分離
    expect(result.shb017.DSC00020).toBeUndefined();
    expect(result.shb017.DSC00030).toBe('1000000');
    expect(result.shb017.DSC00040).toBe('1000000');
    expect(result.shb017.DSC00060).toBe('100000');
    expect(result.shb017.DSC00070).toBe('100000');
    // 第二表：課税資産の譲渡等の対価は生値（RC を含めない）、特定課税仕入れは AAR に別掲
    expect(result.sha010.AAQ00040).toBeUndefined();
    expect(result.sha010.AAQ00050).toBe('1000000');
    expect(result.sha010.AAQ00060).toBe('1000000');
    expect(result.sha010.AAR00020).toBe('100000');
    expect(result.sha010.AAR00030).toBe('100000');
    // 付表2-3：⑨特定課税仕入れの対価・⑩消費税額
    expect(result.shb033.DTE00100).toBe('100000');
    expect(result.shb033.DTE00110).toBe('100000');
    expect(result.shb033.DTE00130).toBe('7800');
    expect(result.shb033.DTE00140).toBe('7800');
    // ⑬課税仕入れ等の税額の合計額（7.8%列 = ⑧7.8 0 ＋ ⑩ 7,800 ＋ ⑪7.8 0）
    expect(result.shb033.DTE00250).toBe('7800');
    expect(result.shb033.DTE00260).toBe('7800');
    // 控除対象仕入税額（一括比例配分）= floor(7,800 × 1,000,000/1,100,000) = 7,090
    expect(result.shb033.DTG00170).toBe('7090');
    // 第一表：課税標準額・消費税額・控除対象仕入税額・差引
    expect(result.sha010.AAJ00010).toBe('1100000');
    expect(result.sha010.AAJ00020).toBe('85800');
    expect(result.sha010.AAJ00050).toBe('7090');
    // 差引 = floor100(85,800 − 7,090) = 78,700
    expect(result.sha010.AAJ00100).toBe('78700');
  });

  test('⑧課税仕入れに係る消費税額は輸入消費税を除いた国内分のみ（⑪との二重計上を回避）', () => {
    const result = mapGeneral({
      taxableBase10: D('1000000'),
      taxableBase8: D('0'),
      input10: D('50000'),
      input8: D('0'),
      ...zeroExtras(),
      importTax10: D('3000'),
    });
    // ⑧7.8 = input10 50,000 − 輸入 3,000 = 47,000（⑪ DTE00170 と重複しない）
    expect(result.shb033.DTE00070).toBe('47000');
    expect(result.shb033.DTE00080).toBe('47000');
    expect(result.shb033.DTE00170).toBe('3000');
    // ⑬7.8 = ⑧47,000 ＋ ⑪3,000 = 50,000
    expect(result.shb033.DTE00250).toBe('50000');
    expect(result.shb033.DTE00260).toBe('50000');
  });

  test('interimPeriod を指定すると AAI00160 に中間申告の対象期間が raw で立つ', () => {
    const result = mapGeneral({
      taxableBase10: D('1000000'),
      taxableBase8: D('0'),
      input10: D('50000'),
      input8: D('0'),
      ...zeroExtras(),
      interimPeriod: { start: '2026-01-01', end: '2026-06-30' },
    });
    expect(result.sha010Raw.AAI00160).toBe(
      '<AAI00170><gen:era>5</gen:era><gen:yy>8</gen:yy><gen:mm>1</gen:mm><gen:dd>1</gen:dd></AAI00170>' +
        '<AAI00180><gen:era>5</gen:era><gen:yy>8</gen:yy><gen:mm>6</gen:mm><gen:dd>30</gen:dd></AAI00180>'
    );
  });

  test('interimPeriod 未指定なら AAI00160 は出力しない', () => {
    const result = mapGeneral({
      taxableBase10: D('1000000'),
      taxableBase8: D('0'),
      input10: D('50000'),
      input8: D('0'),
      ...zeroExtras(),
    });
    expect(result.sha010Raw.AAI00160).toBeUndefined();
  });

  test('本年中の中間納付税額を確定申告の差引税額に充当する（納付が残るケース）', () => {
    const result = mapGeneral({
      taxableBase10: D('3000000'),
      taxableBase8: D('0'),
      input10: D('100000'),
      input8: D('0'),
      ...zeroExtras(),
      interimPaidNational: D('50000'),
      interimPaidLocal: D('10000'),
    });
    // 差引税額（国税） = 234000 − 100000 = 134000
    expect(result.sha010.AAJ00100).toBe('134000');
    expect(result.sha010.AAJ00110).toBe('50000');
    // 納付税額 = 134000 − 50000 = 84000
    expect(result.sha010.AAJ00120).toBe('84000');
    expect(result.sha010.AAJ00130).toBeUndefined();
    // 地方消費税額 37700、中間納付済 10000 → 納付譲渡割額 27700
    expect(result.sha010.AAK00060).toBe('37700');
    expect(result.sha010.AAK00070).toBe('10000');
    expect(result.sha010.AAK00080).toBe('27700');
    expect(result.sha010.AAK00090).toBeUndefined();
    // 合計 = 84000 + 27700 = 111700
    expect(result.sha010.AAK00130).toBe('111700');
  });

  test('仕入税額控除が売上税額を上回る本体還付：差引欄でなく控除不足還付欄へ正値', () => {
    const result = mapGeneral({
      taxableBase10: D('1000000'),
      taxableBase8: D('0'),
      input10: D('200000'),
      input8: D('0'),
      ...zeroExtras(),
    });
    // 売上税額 78000 − 仕入税額控除 200000 = −122000 → 控除不足還付 122000
    expect(result.sha010.AAJ00090).toBe('122000');
    expect(result.sha010.AAJ00100).toBeUndefined();
    // 納付税額（差引の充当先）は出力しない
    expect(result.sha010.AAJ00120).toBeUndefined();
    // 地方：課税標準となる消費税額も控除不足還付欄へ
    expect(result.sha010.AAK00020).toBe('122000');
    expect(result.sha010.AAK00030).toBeUndefined();
    // 譲渡割額 = 122000 × 22/78 = 34410.25… → 百円未満切り捨て 34400 を還付額へ
    expect(result.sha010.AAK00050).toBe('34400');
    expect(result.sha010.AAK00060).toBeUndefined();
    expect(result.sha010.AAK00080).toBeUndefined();
    // 合計（納付又は還付）は符号付き純額（負＝還付）
    expect(result.sha010.AAK00130).toBe('-156400');
    // 付表1-3 も同様に控除不足還付欄へ
    expect(result.shb017.DSG00000).toBe('122000');
    expect(result.shb017.DSH00000).toBeUndefined();
    expect(result.shb017.DSI00010).toBe('122000');
    expect(result.shb017.DSI00020).toBeUndefined();
    expect(result.shb017.DSJ00010).toBe('34400');
    expect(result.shb017.DSJ00020).toBeUndefined();
  });

  test('本体還付かつ中間納付あり:控除不足還付と中間納付還付を二重計上しない', () => {
    const result = mapGeneral({
      taxableBase10: D('1000000'),
      taxableBase8: D('0'),
      input10: D('200000'),
      input8: D('0'),
      ...zeroExtras(),
      interimPaidNational: D('30000'),
      interimPaidLocal: D('5000'),
    });
    // 控除不足還付は据え置き（中間納付の影響を受けない）
    expect(result.sha010.AAJ00090).toBe('122000');
    expect(result.sha010.AAJ00100).toBeUndefined();
    // 差引が無いので中間納付額の全額が中間納付還付税額
    expect(result.sha010.AAJ00110).toBe('30000');
    expect(result.sha010.AAJ00130).toBe('30000');
    expect(result.sha010.AAJ00120).toBeUndefined();
    expect(result.sha010.AAK00090).toBe('5000');
    expect(result.sha010.AAK00080).toBeUndefined();
    // 合計 = −(控除不足還付122000 + 譲渡割還付34400 + 中間納付還付30000 + 5000)
    expect(result.sha010.AAK00130).toBe('-191400');
  });

  test('中間納付税額が確定申告の差引税額を上回る場合は還付になる', () => {
    const result = mapGeneral({
      taxableBase10: D('1000000'),
      taxableBase8: D('0'),
      input10: D('50000'),
      input8: D('0'),
      ...zeroExtras(),
      interimPaidNational: D('100000'),
    });
    // 差引税額（国税） = 78000 − 50000 = 28000。中間納付100000 > 28000 → 還付72000
    expect(result.sha010.AAJ00100).toBe('28000');
    expect(result.sha010.AAJ00110).toBe('100000');
    expect(result.sha010.AAJ00120).toBeUndefined();
    expect(result.sha010.AAJ00130).toBe('72000');
  });
});