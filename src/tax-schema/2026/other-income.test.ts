import { describe, expect, test } from 'vitest';
import { D } from '../../lib/decimal';
import {
  adjustedSalaryIncomeAmount as adjustedSalaryIncomeAmountWith,
  nonPensionOtherIncomeAmount,
  otherIncomeAmount as otherIncomeAmountWith,
  otherMiscIncome,
  publicPensionDeduction,
  resolvePublicPensionIncome,
  salaryIncomeAmount,
  salaryIncomeDeduction,
  totalWithholdingTax,
  type OtherIncomeInput,
  type SalaryAdjustmentEligibility,
} from './other-income';
import type { Decimal } from '../../lib/decimal';
// 直接入力方式（またはその指定が無い入力）で公的年金等を解決して渡す既存テスト用の呼び出し口
function adjustedSalaryIncomeAmount(
  year: number,
  input: OtherIncomeInput,
  eligibility?: SalaryAdjustmentEligibility,
): Decimal {
  return adjustedSalaryIncomeAmountWith(
    year,
    input,
    eligibility,
    resolvePublicPensionIncome(year, input, D(0)),
  );
}
function otherIncomeAmount(
  year: number,
  input: OtherIncomeInput,
  miscExpensesOverride?: Decimal,
  eligibility?: SalaryAdjustmentEligibility,
): Decimal {
  return otherIncomeAmountWith(
    year,
    input,
    miscExpensesOverride,
    eligibility,
    resolvePublicPensionIncome(year, input, D(0)),
  );
}

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

  test('マイナスは0円に切り上げる', () => {
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
    // − 所得金額調整控除②（min(260,000, 10万) + min(300,000, 10万) − 10万 = 100,000）
    expect(r.toString()).toBe('610000');
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
  test('指定時は misc.otherExpenses ではなく上書き値を使う', () => {
    const r = otherIncomeAmount(
      2026,
      { miscIncome: { otherIncome: D(200_000), otherExpenses: D(50_000) } },
      D(200_000),
    );
    expect(r.toString()).toBe('0');
  });
});

describe('adjustedSalaryIncomeAmount（所得金額調整控除、措法41条の3の11）', () => {
  const salary = (paid: number) => ({
    salaryIncome: { paidAmount: D(paid), withholdingTax: D(0) },
  });
  const under23 = {
    selfSpecialDisabled: false,
    hasDependentUnder23: true,
    hasSpecialDisabledRelative: false,
  };

  describe('① 給与収入850万円超で要件を満たす場合（税務解答 No.1411）', () => {
    test('収入900万円：(900万−850万)×10%=5万円を給与所得から差し引く', () => {
      // 9,000,000 − 1,950,000 = 7,050,000
      expect(adjustedSalaryIncomeAmount(2026, salary(9_000_000)).toString()).toBe('7050000');
      expect(adjustedSalaryIncomeAmount(2026, salary(9_000_000), under23).toString()).toBe(
        '7000000',
      );
    });

    test('要件は3つのいずれか', () => {
      const base = salary(9_000_000);
      const none = {
        selfSpecialDisabled: false,
        hasDependentUnder23: false,
        hasSpecialDisabledRelative: false,
      };
      expect(adjustedSalaryIncomeAmount(2026, base, none).toString()).toBe('7050000');
      expect(
        adjustedSalaryIncomeAmount(2026, base, { ...none, selfSpecialDisabled: true }).toString(),
      ).toBe('7000000');
      expect(
        adjustedSalaryIncomeAmount(2026, base, {
          ...none,
          hasSpecialDisabledRelative: true,
        }).toString(),
      ).toBe('7000000');
    });

    test('収入850万円ちょうどは対象外、850万円超から対象', () => {
      expect(adjustedSalaryIncomeAmount(2026, salary(8_500_000), under23).toString()).toBe(
        '6550000',
      );
      // 8,500,001 − 1,950,000 = 6,550,001、控除は0.1円→1円に切り上げ
      expect(adjustedSalaryIncomeAmount(2026, salary(8_500_001), under23).toString()).toBe(
        '6550000',
      );
    });

    test('1円未満の端数は切り上げる（収入が10の倍数でない場合）', () => {
      // 8,500,005 → 0.5円 → 1円。給与所得 6,550,005 − 1
      expect(adjustedSalaryIncomeAmount(2026, salary(8_500_005), under23).toString()).toBe(
        '6550004',
      );
      // 8,500,011 → 1.1円 → 2円。給与所得 6,550,011 − 2
      expect(adjustedSalaryIncomeAmount(2026, salary(8_500_011), under23).toString()).toBe(
        '6550009',
      );
    });

    test('収入1,000万円超でも控除は1,000万円で頭打ち（15万円）', () => {
      // 12,000,000 − 1,950,000 = 10,050,000 − 150,000
      expect(adjustedSalaryIncomeAmount(2026, salary(12_000_000), under23).toString()).toBe(
        '9900000',
      );
      expect(adjustedSalaryIncomeAmount(2026, salary(10_000_000), under23).toString()).toBe(
        '7900000',
      );
    });

    test('eligibility 未指定なら①は適用しない', () => {
      expect(adjustedSalaryIncomeAmount(2026, salary(12_000_000)).toString()).toBe('10050000');
    });

    test('令和7年分以前にも適用する（令和2年分以後の制度）', () => {
      expect(adjustedSalaryIncomeAmount(2025, salary(9_000_000), under23).toString()).toBe(
        '7000000',
      );
    });
  });

  describe('② 給与所得と公的年金等の雑所得の両方がある場合', () => {
    const withPension = (paid: number, pension: number) => ({
      ...salary(paid),
      miscIncome: { publicPensionAmount: D(pension) },
    });

    test('合計が10万円以下なら調整なし（給与所得6万円＋年金4万円）', () => {
      // 800,000 − 740,000 = 60,000
      expect(adjustedSalaryIncomeAmount(2026, withPension(800_000, 40_000)).toString()).toBe(
        '60000',
      );
    });

    test('合計が10万円を超えると超えた分だけ差し引く（給与所得6万円＋年金4万1円）', () => {
      expect(adjustedSalaryIncomeAmount(2026, withPension(800_000, 40_001)).toString()).toBe(
        '59999',
      );
    });

    test('それぞれ10万円を超える場合は10万円', () => {
      // 給与所得 260,000 → 160,000
      expect(adjustedSalaryIncomeAmount(2026, withPension(1_000_000, 300_000)).toString()).toBe(
        '160000',
      );
    });

    test('年金だけ、または給与だけなら調整なし', () => {
      expect(adjustedSalaryIncomeAmount(2026, salary(1_000_000)).toString()).toBe('260000');
      expect(
        adjustedSalaryIncomeAmount(2026, {
          miscIncome: { publicPensionAmount: D(300_000) },
        }).toString(),
      ).toBe('0');
    });

    test('①の後に②を適用する', () => {
      // 9,000,000 − 1,950,000 − 50,000(①) − 100,000(②)
      expect(
        adjustedSalaryIncomeAmount(2026, withPension(9_000_000, 300_000), under23).toString(),
      ).toBe('6900000');
    });
  });

  test('otherIncomeAmount は eligibility を給与所得に反映する', () => {
    const input = salary(9_000_000);
    expect(otherIncomeAmount(2026, input).toString()).toBe('7050000');
    expect(otherIncomeAmount(2026, input, undefined, under23).toString()).toBe('7000000');
  });
});

describe('publicPensionDeduction（所法35条4項・措法41条の15の3の速算表）', () => {
  const income = (revenue: number, age65OrOver: boolean, nonPension: number) =>
    resolvePublicPensionIncome(
      2026,
      { miscIncome: { publicPensionRevenue: D(revenue), publicPensionAge65OrOver: age65OrOver } },
      D(nonPension),
    ).amount.toString();

  test('65歳未満・公的年金等以外の合計所得金額が1,000万円以下', () => {
    expect(income(2_000_000, false, 0)).toBe('1225000');
    expect(income(1_300_001, false, 0)).toBe('700000');
    expect(income(500_000, false, 0)).toBe('0');
    expect(income(4_100_000, false, 0)).toBe('2800000');
    expect(income(10_000_000, false, 0)).toBe('8045000');
  });

  test('区分の境目で控除額が連続する', () => {
    expect(publicPensionDeduction(D(1_300_000), false, D(0)).toString()).toBe('600000');
    expect(publicPensionDeduction(D(4_099_999), false, D(0)).toString()).toBe('1299999.75');
    expect(publicPensionDeduction(D(4_100_000), false, D(0)).toString()).toBe('1300000');
    expect(publicPensionDeduction(D(7_700_000), false, D(0)).toString()).toBe('1840000');
    expect(publicPensionDeduction(D(9_999_999), false, D(0)).toString()).toBe('1954999.95');
    expect(publicPensionDeduction(D(10_000_000), false, D(0)).toString()).toBe('1955000');
  });

  test('公的年金等以外の合計所得金額が1,000万円超・2,000万円超で控除額が10万円ずつ減る', () => {
    expect(income(2_000_000, false, 10_000_000)).toBe('1225000');
    expect(income(2_000_000, false, 10_000_001)).toBe('1325000');
    expect(income(2_000_000, false, 20_000_000)).toBe('1325000');
    expect(income(2_000_000, false, 20_000_001)).toBe('1425000');
  });

  test('65歳以上は最低額が110万円（3,300,000円未満）', () => {
    expect(income(3_000_000, true, 0)).toBe('1900000');
    expect(income(3_300_000, true, 0)).toBe('2200000');
    expect(income(1_000_000, true, 0)).toBe('0');
    expect(income(3_000_000, true, 10_000_001)).toBe('2000000');
    expect(income(3_000_000, true, 20_000_001)).toBe('2100000');
  });

  test('収入が0円以下なら雑所得も0円', () => {
    expect(income(0, true, 0)).toBe('0');
    expect(publicPensionDeduction(D(0), true, D(0)).toString()).toBe('0');
  });
});

describe('resolvePublicPensionIncome（所法35条5項の280万円調整）', () => {
  const pension65 = (revenue: number) => ({
    publicPensionRevenue: D(revenue),
    publicPensionAge65OrOver: true,
  });
  const resolve = (year: number, input: OtherIncomeInput) => {
    const r = resolvePublicPensionIncome(year, input, D(0));
    return { amount: r.amount.toString(), forAdjustment: r.amountForAdjustment.toString() };
  };

  test('給与収入800万円・年金収入300万円：令和9年分は控除額が20万円減り、令和8年分は調整なし', () => {
    const input = {
      salaryIncome: { paidAmount: D(8_000_000), withholdingTax: D(0) },
      miscIncome: pension65(3_000_000),
    };
    // 給与所得控除 1,900,000 + 公的年金等控除 1,100,000 − 2,800,000 = 200,000
    expect(resolve(2027, input)).toEqual({ amount: '2100000', forAdjustment: '1900000' });
    expect(resolve(2026, input)).toEqual({ amount: '1900000', forAdjustment: '1900000' });
  });

  test('給与収入900万円・年金収入115万円：調整後30万円、②の判定は調整前の5万円', () => {
    const input = {
      salaryIncome: { paidAmount: D(9_000_000), withholdingTax: D(0) },
      miscIncome: pension65(1_150_000),
    };
    expect(resolve(2027, input)).toEqual({ amount: '300000', forAdjustment: '50000' });
    expect(resolve(2026, input)).toEqual({ amount: '50000', forAdjustment: '50000' });
    const pension = resolvePublicPensionIncome(2027, input, D(0));
    // ②＝min(7,050,000, 10万) + min(50,000, 10万) − 10万 = 50,000
    expect(adjustedSalaryIncomeAmountWith(2027, input, undefined, pension).toString()).toBe(
      '7000000',
    );
    expect(otherIncomeAmountWith(2027, input, undefined, undefined, pension).toString()).toBe(
      '7300000',
    );
    const pension2026 = resolvePublicPensionIncome(2026, input, D(0));
    expect(otherIncomeAmountWith(2026, input, undefined, undefined, pension2026).toString()).toBe(
      '7050000',
    );
  });

  test('給与収入が無ければ令和9年分でも令和8年分と同じ', () => {
    const input = { miscIncome: pension65(3_000_000) };
    expect(resolve(2027, input)).toEqual(resolve(2026, input));
    expect(resolve(2027, input).amount).toBe('1900000');
  });

  test('控除額の合計が280万円以下なら調整しない', () => {
    const input = {
      salaryIncome: { paidAmount: D(1_000_000), withholdingTax: D(0) },
      miscIncome: pension65(3_000_000),
    };
    expect(resolve(2027, input).amount).toBe('1900000');
  });

  test('直接入力方式：確定額がそのまま両方に入り、令和9年分でも調整しない', () => {
    const input = {
      salaryIncome: { paidAmount: D(9_000_000), withholdingTax: D(0) },
      miscIncome: { publicPensionAmount: D(300_000) },
    };
    expect(resolve(2027, input)).toEqual({ amount: '300000', forAdjustment: '300000' });
    expect(resolve(2026, input)).toEqual({ amount: '300000', forAdjustment: '300000' });
    expect(resolve(2026, {})).toEqual({ amount: '0', forAdjustment: '0' });
  });

  test('1円未満の端数は切り捨てる', () => {
    const input = { miscIncome: { publicPensionRevenue: D(1_300_001) } };
    expect(resolve(2026, input).amount).toBe('700000');
  });
});

describe('nonPensionOtherIncomeAmount（公的年金等以外の所得、所基通35-8）', () => {
  const under23 = {
    selfSpecialDisabled: false,
    hasDependentUnder23: true,
    hasSpecialDisabledRelative: false,
  };

  test('①は引くが②は引かない', () => {
    const input = {
      salaryIncome: { paidAmount: D(9_000_000), withholdingTax: D(0) },
      miscIncome: { publicPensionAmount: D(300_000), otherIncome: D(200_000), otherExpenses: D(0) },
    };
    // 9,000,000 − 1,950,000 − 50,000(①) + 200,000
    expect(nonPensionOtherIncomeAmount(2026, input, undefined, under23).toString()).toBe('7200000');
    expect(nonPensionOtherIncomeAmount(2026, input).toString()).toBe('7250000');
  });

  test('措法27条の特例後経費を使う', () => {
    const input = { miscIncome: { otherIncome: D(200_000), otherExpenses: D(50_000) } };
    expect(nonPensionOtherIncomeAmount(2026, input, D(200_000)).toString()).toBe('0');
  });
});
