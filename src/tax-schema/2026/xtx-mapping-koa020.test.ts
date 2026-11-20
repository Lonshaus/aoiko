import { describe, expect, test } from 'vitest';
import { XtxAmountOutOfRangeError } from './xtx-mapping-shared';
import { D, Decimal } from '../../lib/decimal';
import {
  generalIncomeOf,
  koa020DetailOverflow,
  koa020InputBlocker,
  ordinaryIncomeAmount,
  mapKoa020LeafValues,
  mapKoa020RepeatedValues,
  mapKoa020Values,
  realEstateFamilyEmployeeDeductionResult,
  totalIncomeAmount,
} from './xtx-mapping-koa020';
import { NO_FIXED_ASSET_TRANSFER, type FixedAssetTransfer } from './general-income';
import { mapKoa210Values } from './xtx-mapping-koa210';
import { mapKoa220Values } from './xtx-mapping-koa220';
import { mapKoa110Values } from './xtx-mapping-koa110';
import { personalDeductionsToCtx } from './xtx';
import type { XtxContext } from './xtx';
import type { IncomeDeductionInput } from './income-deductions';
import type { PLReport } from '../../domain/reports';
import type { PersonalDeductionInput } from '../../db/types';

function ctx(overrides: Partial<XtxContext> = {}): XtxContext {
  return {
    year: 2026,
    businessName: 'aoikoウェブ事務所',
    invoiceNumber: '',
    monthly: { year: 2026, months: [], totalSales: '0', totalExpense: '0' },
    pl: {
      year: 2026,
      revenue: [],
      expense: [],
      totalRevenue: '0',
      totalExpense: '0',
      netIncome: '0',
      entryCount: 0,
    },
    bs: {
      year: 2026,
      asOf: '2026-12-31',
      assets: [],
      liabilities: [],
      equity: [],
      netIncome: '0',
      totalAssets: '0',
      totalLiabilitiesAndEquity: '0',
      balanced: true,
    },
    filer: {
      riyoshaId: '1234567890123456',
      name: '青井 太郎',
      zip: '1800001',
      address: '東京都武蔵野市〇〇1-2-3',
      zeimushoCode: '01101',
      zeimushoName: '麹町',
    },
    filingType: 'blue',
    aoiroDeductionKind: 'electronic',
    fixedAssets: [],
    ...overrides,
  };
}

describe('mapKoa020Values（IT部の定義側）', () => {
  test('年分は令和年・屋号は businessName', () => {
    const v = mapKoa020Values(ctx({ year: 2026, businessName: '青井商店' }));
    expect(v.NENBUN).toBe('8');
    expect(v.NOZEISHA_YAGO).toBe('青井商店');
  });

  test('開業前（令和0以下）は NENBUN を出さない', () => {
    const v = mapKoa020Values(ctx({ year: 2018 }));
    expect(v.NENBUN).toBeUndefined();
  });
});

describe('mapKoa020LeafValues（第一表の直接値）', () => {
  // 収入500万・控除前所得500万・電子(65万控除) → 事業所得435万・所得金額435万
  const plBase = {
    year: 2026,
    revenue: [],
    expense: [],
    totalRevenue: '5,000,000.40',
    totalExpense: '0',
    netIncome: '5000000',
    entryCount: 0,
  };

  test('営業収入・事業所得(控除後)・青色控除額を整数円で転記', () => {
    const out = mapKoa020LeafValues(ctx({ pl: { ...plBase }, aoiroDeductionKind: 'electronic' }));
    const values = Object.values(out);
    // 営業等収入=5000000 / 青色控除=650000 / 事業所得=4350000
    expect(values).toContain('5000000');
    expect(values).toContain('650000');
    expect(values).toContain('4350000');
  });

  test('事業の3項目のみ。合計所得・所得控除・税額の欄は出力しない', () => {
    const out = mapKoa020LeafValues(ctx({ pl: { ...plBase }, aoiroDeductionKind: 'electronic' }));
    // 営業収入・事業所得・青色控除額の 3 件のみ（合計⑫は e-Tax 自動計算）
    expect(Object.keys(out)).toHaveLength(3);
  });

  test('簡易簿記(10万控除)なら事業所得=控除前−10万', () => {
    const out = mapKoa020LeafValues(
      ctx({ pl: { ...plBase, netIncome: '2000000' }, aoiroDeductionKind: 'simple' }),
    );
    const values = Object.values(out);
    expect(values).toContain('100000'); // 控除額10万
    expect(values).toContain('1900000'); // 事業所得=控除前200万−10万
  });

  const emptyPersonalDeductions: Omit<IncomeDeductionInput, 'legalTotalIncome' | 'totalIncomeEtc'> =
    {
      socialInsurancePaid: D(400_000),
      smallBusinessMutualAidPaid: D(0),
      lifeInsurance: {},
      earthquakeInsurancePaid: D(0),
      oldLongTermInsurancePaid: D(0),
      medicalExpensePaid: D(0),
      medicalInsuranceReimbursement: D(0),
      donationAmount: D(0),
      casualtyLossDeduction: D(0),
      isDisabled: false,
      isSpecialDisabled: false,
      isSingleParent: false,
      isWidow: false,
      isWorkingStudent: false,
      dependents: [],
    };

  test('personalDeductions 入力時、所得控除・税額の各欄も出力する', () => {
    const out = mapKoa020LeafValues(
      ctx({
        pl: { ...plBase, netIncome: '3000000' },
        aoiroDeductionKind: 'electronic',
        personalDeductions: emptyPersonalDeductions,
      }),
    );
    // 489万円以下 → 基礎控除104万円（令和8年分）
    expect(out.ABB00550).toBe('1040000');
    expect(out.ABB00450).toBe('400000');
    // 事業所得=控除前300万−青色控除65万=235万、所得控除計=104万(基礎)+40万(社保)=144万
    expect(out.ABB00560).toBe('1440000');
    expect(out.ABB00580).toBe('910000'); // 235万-144万
    expect(out.ABB00590).toBeDefined();
    expect(out.ABB01030).toBeDefined();
  });

  test('課税される所得金額は千円未満切捨てで出力する（issue #211）', () => {
    const out = mapKoa020LeafValues(
      ctx({
        pl: { ...plBase, netIncome: '3000300' },
        aoiroDeductionKind: 'electronic',
        personalDeductions: emptyPersonalDeductions,
      }),
    );
    // 235万300−144万=910,300 → (30)欄は千円未満切捨てで 910,000
    expect(out.ABB00580).toBe('910000');
    expect(out.ABB00590).toBe('45500'); // 91万×5%
  });

  test('personalDeductions 未入力なら所得控除・税額の欄は出力しない', () => {
    const out = mapKoa020LeafValues(
      ctx({ pl: { ...plBase, netIncome: '3000000' }, aoiroDeductionKind: 'electronic' }),
    );
    expect(out.ABB00550).toBeUndefined();
    expect(out.ABB00590).toBeUndefined();
  });

  test('配当・住宅ローン控除は差引所得税額で、災害減免額のみ再差引で別枠控除', () => {
    const out = mapKoa020LeafValues(
      ctx({
        pl: { ...plBase, netIncome: '10000000' },
        aoiroDeductionKind: 'electronic',
        personalDeductions: {
          ...emptyPersonalDeductions,
          foreignTaxCreditAmount: D(1000),
          disasterExemptionAmount: D(2000),
        },
      }),
    );
    const diffTax = D(out.ABB00670!);
    const saiSashihiki = D(out.ABB01010!);
    // 再差引所得税額は災害減免額のみ控除（外国税額控除は復興税算定後に控除するため含めない）
    expect(diffTax.minus(saiSashihiki).toString()).toBe('2000');
  });

  test('外国税額控除は復興税算定後：ABB01010/01020/01030 に影響せず申告納税額(ABB00720)で控除', () => {
    // 税額100,000・外国税額10,000・災害減免0・源泉0 の想定チェーン
    const out = mapKoa020LeafValues(
      ctx({
        pl: { ...plBase, netIncome: '10000000' },
        aoiroDeductionKind: 'electronic',
        personalDeductions: {
          ...emptyPersonalDeductions,
          foreignTaxCreditAmount: D(10_000),
        },
      }),
    );
    const taxAmount = D(out.ABB00590!);
    const foreignCredit = D(10_000);
    // ABB01010（再差引）＝税額（外国税額控除は含めない）
    expect(D(out.ABB01010!).toString()).toBe(taxAmount.toString());
    // ABB01020（復興税）＝ABB01010×2.1%（1円未満切捨て）
    expect(D(out.ABB01020!).toString()).toBe(
      taxAmount.times('0.021').toDecimalPlaces(0, Decimal.ROUND_DOWN).toString(),
    );
    // ABB01030（合計）＝ABB01010＋ABB01020
    expect(D(out.ABB01030!).toString()).toBe(D(out.ABB01010!).plus(D(out.ABB01020!)).toString());
    // ABB01040（外国税額控除の欄）は控除額そのものを維持
    expect(out.ABB01040).toBe('10000');
    // ABB00720（申告納税額）＝ABB01030(1,296,777) − 外国税額控除 − 源泉(0)＝1,296,777 の百円未満切捨て
    expect(D(out.ABB01030!).minus(foreignCredit).toString()).toBe('1296777');
    expect(out.ABB00720).toBe('1296700');
  });

  test('給与所得：収入金額等(ABB00080)は税引前、所得金額等(ABB00370)は給与所得控除後', () => {
    const out = mapKoa020LeafValues(
      ctx({
        pl: { ...plBase, netIncome: '0' },
        aoiroDeductionKind: 'electronic',
        personalDeductions: {
          ...emptyPersonalDeductions,
          salaryIncome: { paidAmount: D(1_000_000), withholdingTax: D(30_000) },
        },
      }),
    );
    expect(out.ABB00080).toBe('1000000');
    // 1,000,000 - 740,000(令和8・9年分の給与所得控除) = 260,000
    expect(out.ABB00370).toBe('260000');
  });

  test('給与所得(ABB00370)は年分に応じて算定する（措法29条の4第2項の表／令和10年分以降の本則）', () => {
    const salaryCtx = (year: number, paid: number) =>
      ctx({
        year,
        pl: { ...plBase, netIncome: '0' },
        aoiroDeductionKind: 'electronic',
        personalDeductions: {
          ...emptyPersonalDeductions,
          salaryIncome: { paidAmount: D(paid), withholdingTax: D(0) },
        },
      });
    expect(mapKoa020LeafValues(salaryCtx(2026, 740_500)).ABB00370).toBe('0');
    expect(mapKoa020LeafValues(salaryCtx(2026, 2_198_000)).ABB00370).toBe('1456000');
    // 2,000,000 − 690,000（80,000 + 30% = 680,000 が69万円未満）
    expect(mapKoa020LeafValues(salaryCtx(2028, 2_000_000)).ABB00370).toBe('1310000');
  });

  test('雑所得：公的年金等は所得金額等側のみ、その他雑所得は収入・所得金額等の両方に出力', () => {
    const out = mapKoa020LeafValues(
      ctx({
        pl: { ...plBase, netIncome: '0' },
        aoiroDeductionKind: 'electronic',
        personalDeductions: {
          ...emptyPersonalDeductions,
          miscIncome: {
            publicPensionAmount: D(300_000),
            otherIncome: D(200_000),
            otherExpenses: D(50_000),
          },
        },
      }),
    );
    expect(out.ABB00100).toBeUndefined();
    expect(out.ABB01060).toBe('300000');
    expect(out.ABB00110).toBe('200000');
    expect(out.ABB01120).toBe('150000');
  });

  test('源泉徴収税額(ABB00710)・申告納税額(ABB00720)を算出する', () => {
    const out = mapKoa020LeafValues(
      ctx({
        pl: { ...plBase, netIncome: '3000000' },
        aoiroDeductionKind: 'electronic',
        personalDeductions: {
          ...emptyPersonalDeductions,
          salaryIncome: { paidAmount: D(1_000_000), withholdingTax: D(30_000) },
          otherWithholdingTax: D(5_000),
        },
      }),
    );
    expect(out.ABB00710).toBe('35000');
    // ABB01030 − 35,000 = 24,728 の百円未満切捨て
    expect(D(out.ABB01030!).minus(35000).toString()).toBe('24728');
    expect(out.ABB00720).toBe('24700');
  });

  test('還付（申告納税額がマイナス）は百円未満も切り捨てない', () => {
    const out = mapKoa020LeafValues(
      ctx({
        pl: { ...plBase, netIncome: '3000000' },
        aoiroDeductionKind: 'electronic',
        personalDeductions: {
          ...emptyPersonalDeductions,
          otherWithholdingTax: D(100_001),
        },
      }),
    );
    expect(D(out.ABB00720!).toString()).toBe(D(out.ABB01030!).minus(100_001).toString());
    expect(D(out.ABB00720!).isNegative()).toBe(true);
  });

  describe('所得金額調整控除（措法41条の3の11、税務解答 No.1411）', () => {
    const noBusiness = {
      year: 2026,
      revenue: [],
      expense: [],
      totalRevenue: '0',
      totalExpense: '0',
      netIncome: '0',
      entryCount: 0,
    };

    test('①：給与収入900万円・20歳で所得0の扶養親族 → 給与所得から5万円を差し引く', () => {
      const salaryOnly = {
        ...emptyPersonalDeductions,
        salaryIncome: { paidAmount: D(9_000_000), withholdingTax: D(0) },
      };
      const out = mapKoa020LeafValues(
        ctx({
          pl: noBusiness,
          aoiroDeductionKind: 'electronic',
          personalDeductions: {
            ...salaryOnly,
            dependents: [{ id: 'd1', age: 20, totalIncome: D(0) }],
          },
        }),
      );
      // 9,000,000 − 1,950,000(給与所得控除) − 50,000(①)
      expect(out.ABB00370).toBe('7000000');
      expect(out.ABB00775).toBe('7000000');
      // 7,000,000 − (基礎控除62万 + 社会保険料40万 + 扶養控除63万)
      expect(out.ABB00580).toBe('5350000');
      const control = mapKoa020LeafValues(
        ctx({ pl: noBusiness, aoiroDeductionKind: 'electronic', personalDeductions: salaryOnly }),
      );
      expect(control.ABB00370).toBe('7050000');
    });

    test('②：給与収入100万円＋公的年金等30万円 → 給与所得から10万円を差し引く', () => {
      const out = mapKoa020LeafValues(
        ctx({
          pl: { ...plBase, netIncome: '3000000' },
          aoiroDeductionKind: 'electronic',
          personalDeductions: {
            ...emptyPersonalDeductions,
            salaryIncome: { paidAmount: D(1_000_000), withholdingTax: D(0) },
            miscIncome: { publicPensionAmount: D(300_000) },
          },
        }),
      );
      // 1,000,000 − 740,000 − 100,000(②)
      expect(out.ABB00370).toBe('160000');
      expect(out.ABB01060).toBe('300000');
      // 事業所得 2,350,000 + 所得金額調整控除②を引く前の給与所得 260,000（所基通35-8）
      expect(out.ABB00775).toBe('2610000');
      // 2,810,000 − (基礎控除104万 + 社会保険料40万)
      expect(out.ABB00580).toBe('1370000');
    });

    describe('公的年金等を収入金額から計算する方式', () => {
      const computed = (
        revenue: number,
        age65: boolean,
        salary?: number,
        pl: PLReport = noBusiness,
      ) =>
        mapKoa020LeafValues(
          ctx({
            pl,
            aoiroDeductionKind: 'electronic',
            personalDeductions: {
              ...emptyPersonalDeductions,
              ...(salary !== undefined
                ? { salaryIncome: { paidAmount: D(salary), withholdingTax: D(0) } }
                : {}),
              miscIncome: {
                publicPensionRevenue: D(revenue),
                publicPensionAge65OrOver: age65,
              },
            },
          }),
        );

      test('収入(ABB00100)・計算結果(ABB01060)・公的年金等以外の合計所得金額(ABB00775)を出力する', () => {
        const out = computed(2_000_000, false);
        expect(out.ABB00100).toBe('2000000');
        expect(out.ABB01060).toBe('1225000');
        expect(out.ABB00775).toBe('0');
      });

      test('公的年金等以外の合計所得金額が1,000万円超なら公的年金等控除額が10万円減る', () => {
        const out = computed(2_000_000, false, undefined, {
          ...noBusiness,
          totalRevenue: '12000000',
          netIncome: '12000000',
        });
        expect(D(out.ABB00775!).greaterThan(10_000_000)).toBe(true);
        expect(out.ABB01060).toBe('1325000');
      });

      test('収入が0円なら ABB00100・ABB01060 を出力しない', () => {
        const out = computed(0, true);
        expect(out.ABB00100).toBeUndefined();
        expect(out.ABB01060).toBeUndefined();
      });

      test('合計所得金額に年金所得が入り、②にも使われる（ABB00370・ABB00580）', () => {
        const out = computed(3_000_000, true, 1_000_000);
        expect(out.ABB00100).toBe('3000000');
        expect(out.ABB01060).toBe('1900000');
        // 260,000 − ②(min(260,000, 10万) + min(1,900,000, 10万) − 10万 = 100,000)
        expect(out.ABB00370).toBe('160000');
        expect(out.ABB00775).toBe('260000');
        // 合計所得 160,000 + 1,900,000 = 2,060,000 − (基礎控除104万 + 社会保険料40万)
        expect(out.ABB00580).toBe('620000');
      });
    });

    test('納税者の所得が1,000万円超でも、所得0の特別障害者の配偶者は障害者控除と①の対象', () => {
      const out = mapKoa020LeafValues(
        ctx({
          pl: noBusiness,
          aoiroDeductionKind: 'electronic',
          personalDeductions: {
            ...emptyPersonalDeductions,
            salaryIncome: { paidAmount: D(13_000_000), withholdingTax: D(0) },
            spouse: { totalIncome: D(0), age: 40, disability: 'special' },
          },
        }),
      );
      // 13,000,000 − 1,950,000 − 150,000(①は収入1,000万円で頭打ち)
      expect(out.ABB00370).toBe('10900000');
      expect(out.ABB00520).toBe('0');
      expect(out.ABB00510).toBe('400000');
    });
  });

  test('給与所得・雑所得は合計所得金額（基礎控除の区分判定）にも加算される', () => {
    // 事業所得: 収入500万-青色控除65万=435万。給与所得(収入100万)=26万を加えると461万→
    // 336万円超489万円以下の基礎控除68万円区分に該当する（335万円台なら88万円のはず）
    const out = mapKoa020LeafValues(
      ctx({
        pl: { ...plBase },
        aoiroDeductionKind: 'electronic',
        personalDeductions: {
          ...emptyPersonalDeductions,
          salaryIncome: { paidAmount: D(1_000_000), withholdingTax: D(0) },
        },
      }),
    );
    expect(out.ABB00550).toBe('1040000');
  });

  test('配偶者の合計所得金額(ABB00780)・公的年金等以外の合計所得金額(ABB00775)を出力する', () => {
    const out = mapKoa020LeafValues(
      ctx({
        pl: { ...plBase, netIncome: '3000000' },
        aoiroDeductionKind: 'electronic',
        personalDeductions: {
          ...emptyPersonalDeductions,
          spouse: { totalIncome: D(400_000), age: 40 },
          miscIncome: { publicPensionAmount: D(300_000) },
        },
      }),
    );
    expect(out.ABB00780).toBe('400000');
    // 事業所得235万+雑所得(年金)30万=265万。公的年金等以外=265万-30万=235万
    expect(out.ABB00775).toBe('2350000');
  });
});

function realEstatePl(netIncome: string): PLReport {
  return {
    year: 2026,
    revenue: [],
    expense: [],
    totalRevenue: '0',
    totalExpense: '0',
    netIncome,
    entryCount: 0,
  };
}

describe('totalIncomeAmount / ordinaryIncomeAmount（不動産所得との共有枠、B7 part2）', () => {
  const plBase = {
    year: 2026,
    revenue: [],
    expense: [],
    totalRevenue: '0',
    totalExpense: '0',
    netIncome: '0',
    entryCount: 0,
  };
  const emptyPersonalDeductions: Omit<IncomeDeductionInput, 'legalTotalIncome' | 'totalIncomeEtc'> =
    {
      socialInsurancePaid: D(0),
      smallBusinessMutualAidPaid: D(0),
      lifeInsurance: {},
      earthquakeInsurancePaid: D(0),
      oldLongTermInsurancePaid: D(0),
      medicalExpensePaid: D(0),
      medicalInsuranceReimbursement: D(0),
      donationAmount: D(0),
      casualtyLossDeduction: D(0),
      isDisabled: false,
      isSpecialDisabled: false,
      isSingleParent: false,
      isWidow: false,
      isWorkingStudent: false,
      dependents: [],
    };

  test('不動産所得が無ければ従来どおり単独の青色控除額を使う', () => {
    const c = ctx({ pl: { ...plBase, netIncome: '3000000' }, aoiroDeductionKind: 'electronic' });
    expect(totalIncomeAmount(c).toString()).toBe('2350000');
    expect(ordinaryIncomeAmount(c).toString()).toBe('2350000');
  });

  test('不動産所得の黒字分が共有枠から優先控除され、事業所得側の控除額はその分だけ減る', () => {
    const c = ctx({
      pl: { ...plBase, netIncome: '5000000' },
      aoiroDeductionKind: 'electronic',
      realEstatePl: realEstatePl('4000000'),
      personalDeductions: {
        ...emptyPersonalDeductions,
        realEstateIncome: { businessScale: false },
      },
    });
    // 限度額65万、不動産所得400万から優先控除→65万を使い切り、事業所得側の控除は0
    expect(totalIncomeAmount(c).toString()).toBe('5000000');
    // combinedIncome = 事業所得500万 + 損益通算可能な不動産所得(400万-65万=335万) = 835万
    expect(ordinaryIncomeAmount(c).toString()).toBe('8350000');
  });

  test('不動産所得が赤字で土地等負債利子額があれば、その分だけ合計所得金額から除外される', () => {
    const c = ctx({
      pl: { ...plBase, netIncome: '3000000' },
      aoiroDeductionKind: 'electronic',
      realEstatePl: realEstatePl('-1000000'),
      personalDeductions: {
        ...emptyPersonalDeductions,
        realEstateIncome: { businessScale: true, landLoanInterestAmount: D(300_000) },
      },
    });
    // 事業所得は不動産所得の有無に関わらず単独黒字300万→控除65万→235万
    expect(totalIncomeAmount(c).toString()).toBe('2350000');
    // 不動産所得赤字100万のうち30万は損益通算不可→通算できるのは70万分の赤字
    expect(ordinaryIncomeAmount(c).toString()).toBe('1650000');
  });
});

describe('mapKoa020LeafValues（不動産所得ありの第一表・第二表欄）', () => {
  const plBase = {
    year: 2026,
    revenue: [],
    expense: [],
    totalRevenue: '0',
    totalExpense: '0',
    netIncome: '0',
    entryCount: 0,
  };
  const emptyPersonalDeductions: Omit<IncomeDeductionInput, 'legalTotalIncome' | 'totalIncomeEtc'> =
    {
      socialInsurancePaid: D(0),
      smallBusinessMutualAidPaid: D(0),
      lifeInsurance: {},
      earthquakeInsurancePaid: D(0),
      oldLongTermInsurancePaid: D(0),
      medicalExpensePaid: D(0),
      medicalInsuranceReimbursement: D(0),
      donationAmount: D(0),
      casualtyLossDeduction: D(0),
      isDisabled: false,
      isSpecialDisabled: false,
      isSingleParent: false,
      isWidow: false,
      isWorkingStudent: false,
      dependents: [],
    };

  test('不動産あり：青色控除は2枚合計・収入/所得/第二表控除欄を出力', () => {
    const rePl = realEstatePl('325000');
    rePl.totalRevenue = '352000';
    const out = mapKoa020LeafValues(
      ctx({
        pl: { ...plBase, netIncome: '1044300' },
        aoiroDeductionKind: 'electronic',
        realEstatePl: rePl,
        personalDeductions: {
          ...emptyPersonalDeductions,
          realEstateIncome: { businessScale: false },
        },
      }),
    );
    // ABB00300 営業等所得＝控除前104.43万−配分後控除32.5万＝71.93万
    expect(out.ABB00300).toBe('719300');
    // ABB00050 収入金額等・不動産＝不動産PLの総収入
    expect(out.ABB00050).toBe('352000');
    // ABB00340 所得金額等・不動産＝損益通算可能分（黒字はそのまま、控除後0）
    expect(out.ABB00340).toBe('0');
    // ABB00800 青色申告特別控除額＝事業32.5万＋不動産32.5万＝65万（2枚合計）
    expect(out.ABB00800).toBe('650000');
    // ABI00170 第二表・不動産所得から差し引いた青色申告特別控除額＝不動産充当分32.5万
    expect(out.ABI00170).toBe('325000');
  });

  test('不動産なし：青色控除欄は事業単独・不動産欄は出力しない（回帰なし）', () => {
    const out = mapKoa020LeafValues(
      ctx({ pl: { ...plBase, netIncome: '5000000' }, aoiroDeductionKind: 'electronic' }),
    );
    expect(out.ABB00800).toBe('650000');
    expect(out.ABB00050).toBeUndefined();
    expect(out.ABB00340).toBeUndefined();
    expect(out.ABI00170).toBeUndefined();
  });
});

describe('mapKoa020LeafValues（白色申告：所得控除・税額・不動産所得欄）', () => {
  const plBase = {
    year: 2026,
    revenue: [],
    expense: [],
    totalRevenue: '0',
    totalExpense: '0',
    netIncome: '0',
    entryCount: 0,
  };
  const emptyPersonalDeductions: Omit<IncomeDeductionInput, 'legalTotalIncome' | 'totalIncomeEtc'> =
    {
      socialInsurancePaid: D(400_000),
      smallBusinessMutualAidPaid: D(0),
      lifeInsurance: {},
      earthquakeInsurancePaid: D(0),
      oldLongTermInsurancePaid: D(0),
      medicalExpensePaid: D(0),
      medicalInsuranceReimbursement: D(0),
      donationAmount: D(0),
      casualtyLossDeduction: D(0),
      isDisabled: false,
      isSpecialDisabled: false,
      isSingleParent: false,
      isWidow: false,
      isWorkingStudent: false,
      dependents: [],
    };

  test('白色×personalDeductions：所得控除・課税所得・税額・復興税を出力する', () => {
    const out = mapKoa020LeafValues(
      ctx({
        filingType: 'white',
        pl: { ...plBase, netIncome: '3000000' },
        personalDeductions: emptyPersonalDeductions,
      }),
    );
    // 白色は青色申告特別控除が無いため事業所得＝控除前300万。合計所得300万→基礎控除104万
    expect(out.ABB00550).toBe('1040000');
    expect(out.ABB00560).toBe('1440000'); // 104万(基礎)+40万(社保)
    expect(out.ABB00580).toBe('1560000'); // 300万-144万
    expect(out.ABB00590).toBe('78000'); // 156万×5%
    expect(out.ABB01020).toBeDefined(); // 復興特別所得税
    // 青色申告特別控除欄は白色では出さない
    expect(out.ABB00800).toBeUndefined();
    expect(out.ABI00170).toBeUndefined();
  });

  test('白色×不動産：収入(ABB00050)・損益通算可能額(ABB00340)を出力し青色控除欄は出さない', () => {
    const rePl = realEstatePl('325000');
    rePl.totalRevenue = '352000';
    const out = mapKoa020LeafValues(
      ctx({
        filingType: 'white',
        pl: { ...plBase, netIncome: '1000000' },
        realEstatePl: rePl,
        personalDeductions: {
          ...emptyPersonalDeductions,
          realEstateIncome: { businessScale: false },
        },
      }),
    );
    expect(out.ABB00050).toBe('352000');
    // 白色は青色控除が無いため不動産所得は控除前のまま損益通算可能
    expect(out.ABB00340).toBe('325000');
    expect(out.ABB00800).toBeUndefined();
    expect(out.ABI00170).toBeUndefined();
  });

  test('白色×事業的規模の不動産：貸倒引当金繰入額（不動産）は必要経費のまま損益通算可能額に反映する（issue#378）', () => {
    const rePl: PLReport = {
      year: 2026,
      revenue: [],
      expense: [
        {
          accountCode: '5410',
          accountName: '貸倒引当金繰入額（不動産）',
          category: 'expense',
          amount: '100000',
          displayOrder: 1395,
        },
      ],
      totalRevenue: '0',
      totalExpense: '100000',
      netIncome: '325000',
      entryCount: 0,
    };
    const out = mapKoa020LeafValues(
      ctx({
        filingType: 'white',
        pl: { ...plBase, netIncome: '1000000' },
        realEstatePl: rePl,
        personalDeductions: {
          ...emptyPersonalDeductions,
          realEstateIncome: { businessScale: true },
        },
      }),
    );
    // 事業的規模なら貸倒引当金繰入額（不動産）を加算し戻さない：325,000 のまま
    expect(out.ABB00340).toBe('325000');
  });

  test('専従者控除の上限は貸倒引当金繰入額（不動産）を戻さない所得を基準にする（issue#378）', () => {
    const rePl: PLReport = {
      year: 2026,
      revenue: [],
      expense: [
        {
          accountCode: '5410',
          accountName: '貸倒引当金繰入額（不動産）',
          category: 'expense',
          amount: '400000',
          displayOrder: 1395,
        },
      ],
      totalRevenue: '0',
      totalExpense: '400000',
      netIncome: '1000000',
      entryCount: 0,
    };
    const result = realEstateFamilyEmployeeDeductionResult({
      year: 2026,
      pl: plBase,
      filingType: 'white',
      aoiroDeductionKind: 'none',
      realEstatePl: rePl,
      personalDeductions: {
        ...emptyPersonalDeductions,
        realEstateIncome: { businessScale: true },
        familyEmployees: [
          {
            id: 'f1',
            name: '配偶者花子',
            relation: 'spouse',
            age: 40,
            monthsWorked: 12,
            incomeType: 'realEstate' as const,
          },
        ],
      },
    });
    // 専従者控除前所得金額は100万（貸倒引当金繰入額は戻さない）→100万÷2=50万と
    // 配偶者定額86万のいずれか低い方＝50万（戻していれば140万÷2=70万になり不一致）
    expect(result.total.toString()).toBe('500000');
  });
});

describe('mapKoa020LeafValues / mapKoa020RepeatedValues（白色・事業専従者控除、issue #307）', () => {
  // issue #307 の実例：売上500万・消耗品費100万・専従者給与100万・専従者は配偶者1人。
  function makeCtx(): XtxContext {
    const pl: PLReport = {
      year: 2026,
      revenue: [
        {
          accountCode: '4000',
          accountName: '売上',
          category: 'revenue',
          amount: '5000000',
          displayOrder: 0,
        },
      ],
      expense: [
        {
          accountCode: '5310',
          accountName: '消耗品費',
          category: 'expense',
          amount: '1000000',
          displayOrder: 310,
        },
        {
          accountCode: '5250',
          accountName: '専従者給与',
          category: 'expense',
          amount: '1000000',
          displayOrder: 250,
        },
      ],
      totalRevenue: '5000000',
      totalExpense: '2000000',
      netIncome: '3000000',
      entryCount: 2,
    };
    const personalDeductions = personalDeductionsToCtx({
      socialInsurancePaid: '0',
      smallBusinessMutualAidPaid: '0',
      lifeInsurance: {},
      earthquakeInsurancePaid: '0',
      oldLongTermInsurancePaid: '0',
      medicalExpensePaid: '0',
      medicalInsuranceReimbursement: '0',
      donationAmount: '0',
      casualtyLossDeduction: '0',
      isDisabled: false,
      isSpecialDisabled: false,
      isSingleParent: false,
      isWidow: false,
      isWorkingStudent: false,
      spouse: { totalIncome: '0', age: 40 },
      dependents: [],
      familyEmployees: [
        { id: 'f1', name: '配偶者花子', relation: 'spouse', age: 40, monthsWorked: 12 },
      ],
    });
    return ctx({ filingType: 'white', pl, personalDeductions });
  }

  test('事業所得は専従者控除後の値、配偶者控除は専従者のため0になる', () => {
    const out = mapKoa020LeafValues(makeCtx());
    // 専従者控除前所得金額＝300万(pl.netIncome)＋100万(専従者給与を足し戻し)＝400万。
    // 専従者控除＝配偶者の定額86万と 400万÷(1+1)=200万のいずれか低い方＝86万。
    // 事業所得＝400万−86万＝314万
    expect(out.ABB00300).toBe('3140000');
    expect(out.ABB00790).toBe('860000');
    expect(out.ABB00520).toBe('0'); // 配偶者は事業専従者のため配偶者控除は無し
    // 合計所得金額314万円は336万円以下 → 基礎控除104万円（62万＋暫定加算42万）
    expect(out.ABB00550).toBe('1040000');
    // 所得控除合計＝基礎控除104万円のみ（社保等は全て0、配偶者控除は0）
    expect(out.ABB00560).toBe('1040000');
    // 課税される所得金額＝314万−104万＝210万（千円未満の端数無し）
    expect(out.ABB00580).toBe('2100000');
    // 税額＝210万×10%−97,500円＝112,500円（195万円超330万円以下の令和8年分速算表）
    expect(out.ABB00590).toBe('112500');
  });

  test('ABE00010 事業専従者明細に配偶者の1行を出力する', () => {
    const repeats = mapKoa020RepeatedValues(makeCtx());
    expect(repeats.ABE00010).toHaveLength(1);
    const row = repeats.ABE00010?.[0];
    expect(row?.ABE00020).toBe('配偶者花子');
    expect(row?.ABE00040).toBe('配偶者');
    expect(row?.ABE00060).toBe('従事月数12か月');
    expect(row?.ABE00070).toBe('860000');
    expect(row?.ABE00025).toBeUndefined(); // 個人番号は収集しない
    expect(row?.ABE00030).toBeUndefined(); // 生年月日は収集しない
  });
});
describe('措法25条の2の事業を営むか否かの判定・前々年分収入・家内労働者等の特例', () => {
  const plBase = {
    year: 2026,
    revenue: [],
    expense: [],
    totalRevenue: '0',
    totalExpense: '0',
    netIncome: '0',
    entryCount: 0,
  };
  const emptyPersonalDeductions: Omit<IncomeDeductionInput, 'legalTotalIncome' | 'totalIncomeEtc'> =
    {
      socialInsurancePaid: D(0),
      smallBusinessMutualAidPaid: D(0),
      lifeInsurance: {},
      earthquakeInsurancePaid: D(0),
      oldLongTermInsurancePaid: D(0),
      medicalExpensePaid: D(0),
      medicalInsuranceReimbursement: D(0),
      donationAmount: D(0),
      casualtyLossDeduction: D(0),
      isDisabled: false,
      isSpecialDisabled: false,
      isSingleParent: false,
      isWidow: false,
      isWorkingStudent: false,
      dependents: [],
    };
  function storedBase(overrides: Partial<PersonalDeductionInput> = {}) {
    return {
      socialInsurancePaid: '0',
      smallBusinessMutualAidPaid: '0',
      lifeInsurance: {},
      earthquakeInsurancePaid: '0',
      oldLongTermInsurancePaid: '0',
      medicalExpensePaid: '0',
      medicalInsuranceReimbursement: '0',
      donationAmount: '0',
      casualtyLossDeduction: '0',
      isDisabled: false,
      isSpecialDisabled: false,
      isSingleParent: false,
      isWidow: false,
      isWorkingStudent: false,
      dependents: [],
      ...overrides,
    };
  }

  test('家内労働者等の特例あり／なし（簡易簿記、令和8年分）', () => {
    const withHomeWorker = ctx({
      pl: { ...plBase, totalRevenue: '800000', totalExpense: '100000', netIncome: '700000' },
      aoiroDeductionKind: 'simple',
      personalDeductions: { ...emptyPersonalDeductions, homeWorker: true },
    });
    expect(totalIncomeAmount(withHomeWorker).toString()).toBe('10000');
    expect(mapKoa020LeafValues(withHomeWorker).ABB00800).toBe('100000');
    const koa210With = mapKoa210Values(withHomeWorker);
    expect(koa210With.AMF00500).toBe('110000'); // 控除前所得（特例後）
    expect(koa210With.AMF00510).toBe('100000'); // 控除額
    expect(koa210With.AMF00530).toBe('10000'); // 所得金額（第一表事業所得と一致）

    const withoutHomeWorker = ctx({
      pl: { ...plBase, totalRevenue: '800000', totalExpense: '100000', netIncome: '700000' },
      aoiroDeductionKind: 'simple',
      personalDeductions: emptyPersonalDeductions,
    });
    expect(totalIncomeAmount(withoutHomeWorker).toString()).toBe('600000');
    expect(mapKoa020LeafValues(withoutHomeWorker).ABB00800).toBe('100000');
    const koa210Without = mapKoa210Values(withoutHomeWorker);
    expect(koa210Without.AMF00500).toBe('700000');
    expect(koa210Without.AMF00510).toBe('100000');
    expect(koa210Without.AMF00530).toBe('600000');
  });

  test('令和9年分・簡易簿記・前々年分事業収入1,200万円で事業的規模の不動産所得と合算すると控除0（修正前は100,000）', () => {
    const personalDeductions = personalDeductionsToCtx(
      storedBase({
        priorPriorBusinessRevenue: '12000000',
        realEstateIncome: { businessScale: true },
      }),
    );
    const c = ctx({
      year: 2027,
      pl: { ...plBase, netIncome: '500000' },
      aoiroDeductionKind: 'simple',
      realEstatePl: { ...plBase, netIncome: '300000' },
      personalDeductions,
    });
    expect(mapKoa020LeafValues(c).ABB00800).toBe('0');
    expect(mapKoa210Values(c).AMF00510).toBe('0');
    expect(mapKoa220Values(c).ANF00260).toBe('0');
  });

  test('事業を営んでいなければ前々年分事業収入を渡しても誤って0にならない（100,000のまま）', () => {
    const personalDeductions = personalDeductionsToCtx(
      storedBase({
        priorPriorBusinessRevenue: '12000000',
        realEstateIncome: { businessScale: false },
      }),
    );
    const c = ctx({
      year: 2027,
      pl: { ...plBase },
      aoiroDeductionKind: 'simple',
      realEstatePl: { ...plBase, netIncome: '3000000' },
      personalDeductions,
    });
    expect(mapKoa020LeafValues(c).ABB00800).toBe('100000');
    expect(mapKoa220Values(c).ANF00260).toBe('100000');
  });

  test('事業が赤字でも収入があれば経営事業に当たり、事業的規模でない不動産所得にも65万枠が及ぶ', () => {
    const c = ctx({
      pl: { ...plBase, totalRevenue: '600000', totalExpense: '700000', netIncome: '-100000' },
      aoiroDeductionKind: 'electronic',
      realEstatePl: { ...plBase, netIncome: '3000000' },
      personalDeductions: {
        ...emptyPersonalDeductions,
        realEstateIncome: { businessScale: false },
      },
    });
    expect(mapKoa020LeafValues(c).ABB00800).toBe('650000');
  });

  test('家内労働者等の特例で控除前事業所得が0でも経営事業の判定は変わらない（特例後所得の符号を使うと誤って100,000になる）', () => {
    const c = ctx({
      pl: { ...plBase, totalRevenue: '600000', totalExpense: '100000', netIncome: '500000' },
      aoiroDeductionKind: 'electronic',
      realEstatePl: { ...plBase, netIncome: '3000000' },
      personalDeductions: {
        ...emptyPersonalDeductions,
        homeWorker: true,
        realEstateIncome: { businessScale: false },
      },
    });
    expect(totalIncomeAmount(c).toString()).toBe('0');
    expect(mapKoa020LeafValues(c).ABB00800).toBe('650000');
  });

  test('事業帳への記帳が無ければ経営事業に当たらず、非事業的規模の不動産所得は10万に降格（回帰なし）', () => {
    const c = ctx({
      pl: { ...plBase },
      aoiroDeductionKind: 'electronic',
      realEstatePl: { ...plBase, netIncome: '3000000' },
      personalDeductions: {
        ...emptyPersonalDeductions,
        realEstateIncome: { businessScale: false },
      },
    });
    expect(mapKoa020LeafValues(c).ABB00800).toBe('100000');
  });

  test('家内労働者等の特例・雑所得のみ（事業なし）', () => {
    const c = ctx({
      pl: { ...plBase },
      personalDeductions: {
        ...emptyPersonalDeductions,
        homeWorker: true,
        miscIncome: { otherIncome: D(500_000), otherExpenses: D(50_000) },
      },
    });
    expect(mapKoa020LeafValues(c).ABB01120).toBe('0');
  });

  test('家内労働者等の特例・給与所得ありで保障額から給与所得控除額を差し引く', () => {
    const c = ctx({
      pl: { ...plBase, totalRevenue: '800000', totalExpense: '50000', netIncome: '750000' },
      aoiroDeductionKind: 'simple',
      personalDeductions: {
        ...emptyPersonalDeductions,
        homeWorker: true,
        salaryIncome: { paidAmount: D(600_000), withholdingTax: D(0) },
      },
    });
    expect(totalIncomeAmount(c).toString()).toBe('610000');
  });

  test('事業所得・雑所得を両方持つ場合の措令18条の2第2項2号の按分', () => {
    const c = ctx({
      pl: { ...plBase, totalRevenue: '300000', totalExpense: '100000', netIncome: '200000' },
      personalDeductions: {
        ...emptyPersonalDeductions,
        homeWorker: true,
        miscIncome: { otherIncome: D(200_000), otherExpenses: D(20_000) },
      },
    });
    expect(totalIncomeAmount(c).toString()).toBe('0');
    expect(mapKoa020LeafValues(c).ABB01120).toBe('0');
  });

  test('白色申告・家内労働者等の特例（専従者なし）', () => {
    const c = ctx({
      filingType: 'white',
      pl: { ...plBase, totalRevenue: '800000', totalExpense: '100000', netIncome: '700000' },
      personalDeductions: { ...emptyPersonalDeductions, homeWorker: true },
    });
    expect(totalIncomeAmount(c).toString()).toBe('110000');
    const koa110 = mapKoa110Values(c);
    expect(koa110.AIG00370).toBe('110000'); // 専従者控除前の所得金額（特例後）
    expect(koa110.AIG00380).toBe('0'); // 専従者控除
    expect(koa110.AIG00400).toBe('110000'); // 所得金額（第一表事業所得と一致）
  });

  test('白色申告・家内労働者等の特例＋事業専従者（配偶者）：ABB00790は0、専従者本人は残る', () => {
    const c = ctx({
      filingType: 'white',
      pl: { ...plBase, totalRevenue: '800000', totalExpense: '100000', netIncome: '700000' },
      personalDeductions: {
        ...emptyPersonalDeductions,
        homeWorker: true,
        familyEmployees: [
          { id: 'f1', name: '配偶者花子', relation: 'spouse', age: 40, monthsWorked: 12 },
        ],
      },
    });
    expect(totalIncomeAmount(c).toString()).toBe('110000');
    const out = mapKoa020LeafValues(c);
    expect(out.ABB00790).toBe('0');
    const repeats = mapKoa020RepeatedValues(c);
    expect(repeats.ABE00010).toHaveLength(1);
    expect(repeats.ABE00010?.[0]?.ABE00020).toBe('配偶者花子');
    expect(repeats.ABE00010?.[0]?.ABE00070).toBe('0');
    const koa110 = mapKoa110Values(c);
    expect(koa110.AIG00370).toBe('110000');
    expect(koa110.AIG00380).toBe('0');
    expect(koa110.AIG00400).toBe('110000');
  });

  test('事業側の家内労働者等の特例は不動産側の専従者控除に影響しない（ABB00790は不動産部分のみ）', () => {
    const c = ctx({
      filingType: 'white',
      pl: { ...plBase, totalRevenue: '800000', totalExpense: '100000', netIncome: '700000' },
      realEstatePl: { ...plBase, netIncome: '3000000' },
      personalDeductions: {
        ...emptyPersonalDeductions,
        homeWorker: true,
        realEstateIncome: { businessScale: true },
        familyEmployees: [
          { id: 'f1', name: '配偶者花子', relation: 'spouse', age: 40, monthsWorked: 12 },
          {
            id: 'f2',
            name: '親族次郎',
            relation: 'other',
            age: 20,
            monthsWorked: 12,
            incomeType: 'realEstate' as const,
          },
        ],
      },
    });
    const out = mapKoa020LeafValues(c);
    expect(out.ABB00790).toBe('500000');
    const repeats = mapKoa020RepeatedValues(c);
    const business = repeats.ABE00010?.find((r) => r.ABE00020 === '配偶者花子');
    const realEstate = repeats.ABE00010?.find((r) => r.ABE00020 === '親族次郎');
    expect(business?.ABE00070).toBe('0');
    expect(realEstate?.ABE00070).toBe('500000');
  });
});
describe('計算部分：ctx.cashBasis が青色申告特別控除に反映される', () => {
  test('cashBasis=true・electronic・令和8年分：控除は10万に留まる（65万ではない）', () => {
    const c = ctx({
      pl: {
        year: 2026,
        revenue: [],
        expense: [],
        totalRevenue: '2000000',
        totalExpense: '0',
        netIncome: '2000000',
        entryCount: 0,
      },
      aoiroDeductionKind: 'electronic',
      cashBasis: true,
    });
    expect(totalIncomeAmount(c).toString()).toBe('1900000');
    expect(mapKoa020LeafValues(c).ABB00800).toBe('100000');
  });
});

describe('gen:kingaku に収まらない値', () => {
  test.each(['abc', '1e+21', '1000000000000000'])('収入金額 %j は省かずに例外にする', (v) => {
    const base = ctx();
    expect(() => mapKoa020LeafValues(ctx({ pl: { ...base.pl, totalRevenue: v } }))).toThrow(
      XtxAmountOutOfRangeError,
    );
  });
});

describe('総合課税の利子・配当・譲渡・一時所得（第一表・第二表）', () => {
  const plBase = {
    year: 2026,
    revenue: [],
    expense: [],
    totalRevenue: '0',
    totalExpense: '0',
    netIncome: '0',
    entryCount: 0,
  };
  const base: Omit<IncomeDeductionInput, 'legalTotalIncome' | 'totalIncomeEtc'> = {
    socialInsurancePaid: D(0),
    smallBusinessMutualAidPaid: D(0),
    lifeInsurance: {},
    earthquakeInsurancePaid: D(0),
    oldLongTermInsurancePaid: D(0),
    medicalExpensePaid: D(0),
    medicalInsuranceReimbursement: D(0),
    donationAmount: D(0),
    casualtyLossDeduction: D(0),
    isDisabled: false,
    isSpecialDisabled: false,
    isSingleParent: false,
    isWidow: false,
    isWorkingStudent: false,
    dependents: [],
  };
  type Deductions = NonNullable<XtxContext['personalDeductions']>;
  const occasionalOf = (over: Partial<NonNullable<Deductions['occasionalIncome']>> = {}) => ({
    revenue: D(1_500_000),
    expenses: D(0),
    withholdingTax: D(0),
    category: '生命保険の満期返戻金',
    payerName: '青空生命保険',
    payerAddress: '東京都千代田区1-1',
    ...over,
  });
  const itemOf = (
    term: 'short' | 'long',
    revenue: number,
    acquisitionCost = 0,
    expenses = 0,
    nonEssential = false,
  ) => ({
    term,
    revenue: D(revenue),
    acquisitionCost: D(acquisitionCost),
    expenses: D(expenses),
    nonEssential,
  });
  const withDeductions = (over: Partial<Deductions>, ctxOver: Partial<XtxContext> = {}) =>
    ctx({ pl: plBase, personalDeductions: { ...base, ...over }, ...ctxOver });

  test('例1：一時所得 収入 150 万円・支出 0 → ABB00230＝100 万円・ABB00400＝50 万円・ABX と ABD が各 1 行', () => {
    const c = withDeductions({ occasionalIncome: occasionalOf() });
    const out = mapKoa020LeafValues(c);
    expect(out.ABB00230).toBe('1000000');
    expect(out.ABB00400).toBe('500000');
    expect(out.ABB00130).toBeUndefined();
    expect(out.ABB00180).toBeUndefined();
    const repeats = mapKoa020RepeatedValues(c);
    expect(repeats.ABX00000).toEqual([
      { ABX00250: '一時', ABX00260: '1500000', ABX00290: '0', ABX00310: '1500000' },
    ]);
    expect(repeats.ABD00010).toEqual([
      {
        ABD00020: '一時',
        ABD00025: '生命保険の満期返戻金',
        ABD00030: '東京都千代田区1-1',
        ABD00040: '青空生命保険',
        ABD00050: '1500000',
      },
    ]);
    expect(koa020InputBlocker(c)).toBeUndefined();
  });

  test('一時所得の源泉徴収税額は ABD00060 と ABB00710 に出し、0 のときは ABD00060 を出さない', () => {
    const withTax = withDeductions({
      occasionalIncome: occasionalOf({ withholdingTax: D(30_630) }),
    });
    expect(mapKoa020RepeatedValues(withTax).ABD00010?.[0]?.ABD00060).toBe('30630');
    expect(mapKoa020LeafValues(withTax).ABB00710).toBe('30630');
    expect(mapKoa020LeafValues(withTax).ABB00810).toBe('30630');
    const without = withDeductions({ occasionalIncome: occasionalOf() });
    expect(mapKoa020RepeatedValues(without).ABD00010?.[0]).not.toHaveProperty('ABD00060');
    expect(mapKoa020LeafValues(without)).not.toHaveProperty('ABB00810');
  });

  test('例2：他の資産の短期譲渡（収入 120 万円・取得費 50 万円・費用 10 万円）→ ABB00130＝ABB00400＝10 万円、.xtx は KOC020 で止まる', () => {
    const c = withDeductions({
      generalTransferIncome: [itemOf('short', 1_200_000, 500_000, 100_000)],
    });
    const out = mapKoa020LeafValues(c);
    expect(out.ABB00130).toBe('100000');
    expect(out.ABB00400).toBe('100000');
    expect(mapKoa020RepeatedValues(c).ABX00000).toEqual([
      { ABX00250: '譲渡（短期）', ABX00260: '1200000', ABX00290: '600000', ABX00310: '600000' },
    ]);
    expect(koa020InputBlocker(c)).toEqual({ reason: 'transfer-koc020' });
  });

  test('例3：長期譲渡 差引 80 万円 → ABB00180＝30 万円・ABB00400＝15 万円', () => {
    const c = withDeductions({ generalTransferIncome: [itemOf('long', 800_000)] });
    const out = mapKoa020LeafValues(c);
    expect(out.ABB00180).toBe('300000');
    expect(out.ABB00400).toBe('150000');
    expect(mapKoa020RepeatedValues(c).ABX00000?.[0]?.ABX00250).toBe('譲渡（長期）');
  });

  test('利子は所得金額等 ABB00350、配当は収入金額等 ABB00070 と所得金額等 ABB00360（収入−負債の利子）', () => {
    const out = mapKoa020LeafValues(
      withDeductions({
        interestIncome: { amount: D(100_000), withholdingTax: D(15_315) },
        dividendIncome: {
          revenue: D(300_000),
          debtInterest: D(100_000),
          withholdingTax: D(61_260),
        },
      }),
    );
    expect(out.ABB00350).toBe('100000');
    expect(out.ABB00070).toBe('300000');
    expect(out.ABB00360).toBe('200000');
    expect(out.ABB00710).toBe('76575');
  });

  test('配当が負債の利子を下回っても ABB00360 は 0 で、利子・配当が 0 の欄は出さない', () => {
    const out = mapKoa020LeafValues(
      withDeductions({
        interestIncome: { amount: D(0), withholdingTax: D(0) },
        dividendIncome: { revenue: D(100_000), debtInterest: D(150_000), withholdingTax: D(0) },
      }),
    );
    expect(out.ABB00360).toBe('0');
    expect(out.ABB00350).toBeUndefined();
  });

  test('課税される所得金額は利子・配当を含む総所得金額から所得控除を引く', () => {
    const c = withDeductions(
      {
        socialInsurancePaid: D(400_000),
        interestIncome: { amount: D(100_000), withholdingTax: D(0) },
        dividendIncome: { revenue: D(300_000), debtInterest: D(100_000), withholdingTax: D(0) },
      },
      { pl: { ...plBase, netIncome: '3000000' } },
    );
    const out = mapKoa020LeafValues(c);
    // 事業 235 万円＋利子 10 万円＋配当 20 万円＝265 万円、控除は基礎 104 万円＋社会保険料 40 万円
    expect(out.ABB00580).toBe('1210000');
    expect(out.ABB00775).toBe('2650000');
  });

  test('合計所得金額が 489 万円を超えると基礎控除が 104 万円から 67 万円へ変わる', () => {
    const at = (dividend: number) =>
      mapKoa020LeafValues(
        withDeductions(
          { dividendIncome: { revenue: D(dividend), debtInterest: D(0), withholdingTax: D(0) } },
          { pl: { ...plBase, netIncome: '3000000' } },
        ),
      );
    expect(at(2_540_000).ABB00550).toBe('1040000');
    expect(at(2_540_001).ABB00550).toBe('670000');
  });

  test('建物等の売却は総合譲渡に入れず、ABB00130・ABB00180・ABB00400 を出さない', () => {
    const transfer: FixedAssetTransfer = {
      ...NO_FIXED_ASSET_TRANSFER,
      totals: { ...NO_FIXED_ASSET_TRANSFER.totals, separateNames: ['事務所建物'] },
    };
    const c = withDeductions({}, { fixedAssetTransfer: transfer });
    const out = mapKoa020LeafValues(c);
    expect(out.ABB00130).toBeUndefined();
    expect(out.ABB00180).toBeUndefined();
    expect(out.ABB00400).toBeUndefined();
    expect(mapKoa020RepeatedValues(c).ABX00000).toBeUndefined();
    expect(generalIncomeOf(c).hasTransfer).toBe(false);
    expect(koa020InputBlocker(c)).toBeUndefined();
  });

  test('固定資産の売却（総合部分）がある年は、短期・長期の行と KOC020 の案内になる', () => {
    const transfer: FixedAssetTransfer = {
      ...NO_FIXED_ASSET_TRANSFER,
      totals: {
        ...NO_FIXED_ASSET_TRANSFER.totals,
        longTerm: D(800_000),
        longRevenue: D(1_500_000),
        longExpense: D(700_000),
        longCount: 1,
      },
    };
    const c = withDeductions({}, { fixedAssetTransfer: transfer });
    expect(mapKoa020LeafValues(c).ABB00180).toBe('300000');
    expect(mapKoa020RepeatedValues(c).ABX00000).toEqual([
      { ABX00250: '譲渡（長期）', ABX00260: '1500000', ABX00290: '700000', ABX00310: '800000' },
    ]);
    expect(koa020InputBlocker(c)).toEqual({ reason: 'transfer-koc020' });
    expect(koa020InputBlocker(ctx({ fixedAssetTransfer: transfer }))).toEqual({
      reason: 'transfer-koc020',
    });
  });

  test('当年に売却した資産を計算できないときは、資産名つきで止める', () => {
    const c = withDeductions({}, { fixedAssetTransfer: { ok: false, names: ['機材A', '機材B'] } });
    expect(koa020InputBlocker(c)).toEqual({
      reason: 'asset-transfer-failed',
      names: ['機材A', '機材B'],
    });
  });

  test('支払者の名称がない一時所得は止める（空白・改行だけでも同じ）', () => {
    for (const payerName of ['', ' \n\t ']) {
      const c = withDeductions({ occasionalIncome: occasionalOf({ payerName }) });
      expect(koa020InputBlocker(c)).toEqual({ reason: 'payer-name-missing' });
    }
    const noRevenue = withDeductions({
      occasionalIncome: occasionalOf({ payerName: '', revenue: D(0) }),
    });
    expect(koa020InputBlocker(noRevenue)).toBeUndefined();
  });

  test('生活に通常必要でない資産とその他の資産の損失が両方あると UNCONFIRMED で止める', () => {
    const c = withDeductions({
      generalTransferIncome: [
        itemOf('long', 200_000, 500_000, 0, true),
        itemOf('short', 100_000, 300_000),
      ],
    });
    expect(koa020InputBlocker(c)).toEqual({ reason: 'nonessential-unconfirmed' });
  });

  test('(a) 事業赤字が長期譲渡と一時所得から引かれ、総所得金額は令198条の順で 5 万円', () => {
    const c = withDeductions(
      {
        generalTransferIncome: [itemOf('long', 800_000)],
        occasionalIncome: occasionalOf({ revenue: D(800_000) }),
      },
      { pl: { ...plBase, totalExpense: '500000', netIncome: '-500000' } },
    );
    const g = generalIncomeOf(c);
    expect(g.nettedLong.toString()).toBe('0');
    expect(g.nettedOccasional.toString()).toBe('100000');
    expect(g.aggregate.toString()).toBe('50000');
    expect(koa020InputBlocker(c)).toEqual({ reason: 'transfer-koc020' });
  });

  test('(b) 短期譲渡の赤字は一時所得から先に引き、経常所得は残る', () => {
    const c = withDeductions({
      miscIncome: { otherIncome: D(300_000), otherExpenses: D(0) },
      generalTransferIncome: [itemOf('short', 400_000, 1_000_000)],
      occasionalIncome: occasionalOf({ revenue: D(1_100_000) }),
    });
    const g = generalIncomeOf(c);
    expect(g.nettedOccasional.toString()).toBe('0');
    expect(g.nettedOrdinary.toString()).toBe('300000');
    expect(g.aggregate.toString()).toBe('300000');
    expect(koa020InputBlocker(c)).toEqual({ reason: 'transfer-koc020' });
  });

  test('事業赤字があり一時所得もあるときは損益の通算の計算書が要るため止める', () => {
    const c = withDeductions(
      { occasionalIncome: occasionalOf({ revenue: D(800_000) }) },
      { pl: { ...plBase, totalExpense: '300000', netIncome: '-300000' } },
    );
    expect(koa020InputBlocker(c)).toEqual({ reason: 'netting-statement' });
  });

  test('事業赤字だけで総合譲渡も一時所得もなければ、従来どおり出力する', () => {
    const c = withDeductions(
      {},
      { pl: { ...plBase, totalExpense: '300000', netIncome: '-300000' } },
    );
    expect(koa020InputBlocker(c)).toBeUndefined();
    const out = mapKoa020LeafValues(c);
    expect(out.ABB00300).toBe('-300000');
    expect(out.ABB00400).toBeUndefined();
    expect(out.ABB00580).toBe('0');
  });

  test('新しい入力がなく当年の売却もなければ、出力は fixedAssetTransfer の有無で変わらず新しい欄も出さない', () => {
    const plain = withDeductions({}, { pl: { ...plBase, netIncome: '3000000' } });
    const none = withDeductions(
      {},
      { pl: { ...plBase, netIncome: '3000000' }, fixedAssetTransfer: NO_FIXED_ASSET_TRANSFER },
    );
    expect(mapKoa020LeafValues(none)).toEqual(mapKoa020LeafValues(plain));
    expect(mapKoa020RepeatedValues(none)).toEqual(mapKoa020RepeatedValues(plain));
    const out = mapKoa020LeafValues(plain);
    for (const tag of [
      'ABB00070',
      'ABB00130',
      'ABB00180',
      'ABB00230',
      'ABB00350',
      'ABB00360',
      'ABB00400',
    ]) {
      expect(out[tag]).toBeUndefined();
    }
    expect(mapKoa020RepeatedValues(plain)).toEqual({});
    expect(koa020InputBlocker(plain)).toBeUndefined();
    expect(out.ABB00580).toBe('1310000');
  });

  test('種目は 10 字、所在地等は 100 字に切り、改行とタブを含めない', () => {
    const address = 'あ'.repeat(60) + '\n\t' + 'い'.repeat(100);
    const c = withDeductions({
      occasionalIncome: occasionalOf({ category: '123456789012345', payerAddress: address }),
    });
    const row = mapKoa020RepeatedValues(c).ABD00010?.[0];
    expect(row?.ABD00025).toBe('1234567890');
    expect(row?.ABD00030).toBe('あ'.repeat(60) + ' ' + 'い'.repeat(39));
    expect(row?.ABD00030).toHaveLength(100);
    expect(row?.ABD00030).not.toMatch(/[\n\r\t]/);
  });

  test('種目・所在地が空なら ABD00025・ABD00030 を出さない', () => {
    const c = withDeductions({
      occasionalIncome: occasionalOf({ category: '', payerAddress: '' }),
    });
    const row = mapKoa020RepeatedValues(c).ABD00010?.[0];
    expect(row).not.toHaveProperty('ABD00025');
    expect(row).not.toHaveProperty('ABD00030');
  });

  test('ABX は 2 行までで、3 行目（一時所得）は koa020DetailOverflow に出る', () => {
    const transfer: FixedAssetTransfer = {
      ...NO_FIXED_ASSET_TRANSFER,
      totals: {
        ...NO_FIXED_ASSET_TRANSFER.totals,
        shortTerm: D(600_000),
        shortRevenue: D(900_000),
        shortExpense: D(300_000),
        shortCount: 1,
      },
    };
    const c = withDeductions(
      {
        generalTransferIncome: [itemOf('long', 800_000)],
        occasionalIncome: occasionalOf(),
      },
      { fixedAssetTransfer: transfer },
    );
    const repeats = mapKoa020RepeatedValues(c);
    expect(repeats.ABX00000?.map((r) => r.ABX00250)).toEqual(['譲渡（短期）', '譲渡（長期）']);
    expect(koa020DetailOverflow(c)).toEqual([
      { section: 'transferIncome', label: '一時', amount: '1500000' },
    ]);
  });
});
