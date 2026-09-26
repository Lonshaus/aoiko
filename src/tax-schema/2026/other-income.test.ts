import { describe, expect, test } from 'vitest';
import { D } from '../../lib/decimal';
import {
  otherIncomeAmount,
  otherMiscIncome,
  salaryIncomeAmount,
  salaryIncomeDeduction,
  totalWithholdingTax,
} from './other-income';

describe('salaryIncomeDeduction（令和8・9年分は措法29条の4第1項、令和10年分以降は所法28条3項）', () => {
  test('令和8年分：220万円以下は74万円、ただし収入が74万円未満なら収入金額が上限', () => {
    expect(salaryIncomeDeduction(2026, D(0)).toString()).toBe('0');
    expect(salaryIncomeDeduction(2026, D(600_000)).toString()).toBe('600000');
    expect(salaryIncomeDeduction(2026, D(739_999)).toString()).toBe('739999');
    expect(salaryIncomeDeduction(2026, D(740_000)).toString()).toBe('740000');
    expect(salaryIncomeDeduction(2026, D(2_200_000)).toString()).toBe('740000');
  });

  test('令和9年分も同じ特例', () => {
    expect(salaryIncomeDeduction(2027, D(600_000)).toString()).toBe('600000');
    expect(salaryIncomeDeduction(2027, D(2_200_000)).toString()).toBe('740000');
  });

  test('220万円超360万円以下は収入×30%+8万円（220万円の接続点で連続）', () => {
    expect(salaryIncomeDeduction(2026, D(2_200_001)).toString()).toBe('740000');
    expect(salaryIncomeDeduction(2026, D(3_600_000)).toString()).toBe('1160000');
  });

  test('360万円超660万円以下は収入×20%+44万円（360万円の接続点で連続）', () => {
    expect(salaryIncomeDeduction(2026, D(3_600_001)).toString()).toBe('1160000');
    expect(salaryIncomeDeduction(2026, D(6_600_000)).toString()).toBe('1760000');
  });

  test('660万円超850万円以下は収入×10%+110万円（660万円の接続点で連続）', () => {
    expect(salaryIncomeDeduction(2026, D(6_600_001)).toString()).toBe('1760000');
    expect(salaryIncomeDeduction(2026, D(8_500_000)).toString()).toBe('1950000');
  });

  test('850万円超は一律195万円（上限、850万円の接続点で連続）', () => {
    expect(salaryIncomeDeduction(2026, D(8_500_001)).toString()).toBe('1950000');
    expect(salaryIncomeDeduction(2026, D(20_000_000)).toString()).toBe('1950000');
  });

  test('令和10年分：8万円+収入×30%、69万円未満なら69万円（収入金額による上限は無い）', () => {
    // 80,000 + 2,000,000×30% = 680,000 < 690,000
    expect(salaryIncomeDeduction(2028, D(2_000_000)).toString()).toBe('690000');
    // 80,000 + 3,000,000×30% = 980,000
    expect(salaryIncomeDeduction(2028, D(3_000_000)).toString()).toBe('980000');
    expect(salaryIncomeDeduction(2028, D(500_000)).toString()).toBe('690000');
    expect(salaryIncomeDeduction(2028, D(6_600_000)).toString()).toBe('1760000');
  });
});

describe('salaryIncomeAmount', () => {
  test('控除後がマイナスなら0円', () => {
    expect(salaryIncomeAmount(2026, D(500_000)).toString()).toBe('0');
  });

  test('控除後がプラスならその額', () => {
    // 1,000,000 - 740,000 = 260,000
    expect(salaryIncomeAmount(2026, D(1_000_000)).toString()).toBe('260000');
  });

  test('令和8年分：収入74万円は給与所得0円', () => {
    expect(salaryIncomeAmount(2026, D(740_000)).toString()).toBe('0');
  });

  test('令和8年分：69万1千円以上74万1千円未満は給与所得なし（措法29条の4第2項1号）', () => {
    expect(salaryIncomeAmount(2026, D(691_000)).toString()).toBe('0');
    expect(salaryIncomeAmount(2026, D(740_500)).toString()).toBe('0');
    expect(salaryIncomeAmount(2026, D(740_999)).toString()).toBe('0');
  });

  test('令和8年分：74万1千円以上219万1千円未満は収入−74万円（同2号）', () => {
    expect(salaryIncomeAmount(2026, D(741_000)).toString()).toBe('1000');
    expect(salaryIncomeAmount(2026, D(2_190_999)).toString()).toBe('1450999');
  });

  test('令和8年分：219万1千円以上220万円未満は3段階の定額（同3〜5号）', () => {
    expect(salaryIncomeAmount(2026, D(2_191_000)).toString()).toBe('1451000');
    expect(salaryIncomeAmount(2026, D(2_192_000)).toString()).toBe('1451000');
    expect(salaryIncomeAmount(2026, D(2_193_000)).toString()).toBe('1453000');
    expect(salaryIncomeAmount(2026, D(2_194_000)).toString()).toBe('1453000');
    expect(salaryIncomeAmount(2026, D(2_195_000)).toString()).toBe('1453000');
    expect(salaryIncomeAmount(2026, D(2_196_000)).toString()).toBe('1456000');
    expect(salaryIncomeAmount(2026, D(2_198_000)).toString()).toBe('1456000');
    expect(salaryIncomeAmount(2026, D(2_199_999)).toString()).toBe('1456000');
  });

  test('令和8年分：収入220万円は第2項の対象外で 2,200,000 − 740,000', () => {
    expect(salaryIncomeAmount(2026, D(2_200_000)).toString()).toBe('1460000');
  });

  test('令和9年分も同じ表', () => {
    expect(salaryIncomeAmount(2027, D(2_194_000)).toString()).toBe('1453000');
  });

  test('令和10年分は660万円未満なら本則ではなく別表第五（表）を使う（所法28条4項）', () => {
    // 2,194,000円の区分は2,192,000円（4,000円区分の下限）で本則を評価した1,454,400円
    // （本則を2,194,000円にそのまま当てると1,455,800円になり、表とは一致しない）
    expect(salaryIncomeAmount(2028, D(2_194_000)).toString()).toBe('1454400');
    // 2,000,000円は表の連続区分（69万円控除）に入るため本則と同値
    expect(salaryIncomeAmount(2028, D(2_000_000)).toString()).toBe('1310000');
    expect(salaryIncomeAmount(2028, D(600_000)).toString()).toBe('0');
  });

  describe('別表第五の区分値（本則の連続値ではない）', () => {
    test('令和10年分・収入3,000,001円', () => {
      expect(salaryIncomeAmount(2028, D(3_000_001)).toString()).toBe('2020000');
    });
  });

  describe('令和8年分・収入670,000円は新旧表で結果が異なる', () => {
    test('未指定（新表）は0円、lastPaymentBeforeDecember指定（旧表）は20,000円', () => {
      expect(salaryIncomeAmount(2026, D(670_000)).toString()).toBe('0');
      expect(salaryIncomeAmount(2026, D(670_000), true).toString()).toBe('20000');
    });
  });

  describe('令和8年分・収入1,500,000円は措法29条の4第2項が優先し新旧表の指定を問わない', () => {
    test('lastPaymentBeforeDecember の有無に関わらず760,000円', () => {
      expect(salaryIncomeAmount(2026, D(1_500_000)).toString()).toBe('760000');
      expect(salaryIncomeAmount(2026, D(1_500_000), true).toString()).toBe('760000');
    });
  });
});

describe('otherMiscIncome（その他雑所得＝収入−必要経費）', () => {
  test('通常はそのまま差し引く', () => {
    expect(otherMiscIncome(D(300_000), D(100_000)).toString()).toBe('200000');
  });

  test('マイナスは0円に floor', () => {
    expect(otherMiscIncome(D(100_000), D(150_000)).toString()).toBe('0');
  });
});

describe('otherIncomeAmount（給与所得＋雑所得の合算）', () => {
  test('何も入力が無ければ0円', () => {
    expect(otherIncomeAmount(2026, {}).toString()).toBe('0');
  });

  test('給与所得のみ', () => {
    const r = otherIncomeAmount(2026, {
      salaryIncome: { paidAmount: D(1_000_000), withholdingTax: D(0) },
    });
    expect(r.toString()).toBe('260000');
  });

  test('給与所得＋公的年金等＋その他雑所得を合算する', () => {
    const r = otherIncomeAmount(2026, {
      salaryIncome: { paidAmount: D(1_000_000), withholdingTax: D(0) },
      miscIncome: {
        publicPensionAmount: D(300_000),
        otherIncome: D(200_000),
        otherExpenses: D(50_000),
      },
    });
    // 260,000（給与） + 300,000（年金、直接入力） + 150,000（その他雑所得）
    expect(r.toString()).toBe('710000');
  });

  test('年分が給与所得の計算に渡る', () => {
    const input = { salaryIncome: { paidAmount: D(2_194_000), withholdingTax: D(0) } };
    expect(otherIncomeAmount(2026, input).toString()).toBe('1453000');
    expect(otherIncomeAmount(2028, input).toString()).toBe('1454400');
  });
});

describe('totalWithholdingTax（源泉徴収税額の合計）', () => {
  test('給与の源泉徴収税額のみ', () => {
    const r = totalWithholdingTax({
      salaryIncome: { paidAmount: D(1_000_000), withholdingTax: D(30_000) },
    });
    expect(r.toString()).toBe('30000');
  });

  test('給与＋事業所得側の源泉徴収税額を合算する', () => {
    const r = totalWithholdingTax({
      salaryIncome: { paidAmount: D(1_000_000), withholdingTax: D(30_000) },
      otherWithholdingTax: D(10_000),
    });
    expect(r.toString()).toBe('40000');
  });

  test('何も入力が無ければ0円', () => {
    expect(totalWithholdingTax({}).toString()).toBe('0');
  });
});

describe('otherIncomeAmount：miscExpensesOverride（措法27条の特例後経費を優先）', () => {
  test('指定時は misc.otherExpenses ではなく override を使う', () => {
    const r = otherIncomeAmount(
      2026,
      { miscIncome: { otherIncome: D(200_000), otherExpenses: D(50_000) } },
      D(200_000),
    );
    expect(r.toString()).toBe('0');
  });
});
