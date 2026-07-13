import { describe, expect, test } from 'vitest';
import { D } from '../../lib/decimal';
import {
  combinedTotalIncomeAmount,
  mapKoa020LeafValues,
  mapKoa020Values,
  totalIncomeAmount,
} from './xtx-mapping-koa020';
import type { XtxContext } from './xtx';
import type { IncomeDeductionInput } from './income-deductions';
import type { PLReport } from '../../domain/reports';

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

describe('mapKoa020Values（IT部 定義側）', () => {
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

describe('mapKoa020LeafValues（第一表 直接値）', () => {
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

  test('営業収入・事業所得(控除後)・青色控除額を整数円で対映', () => {
    const out = mapKoa020LeafValues(ctx({ pl: { ...plBase }, aoiroDeductionKind: 'electronic' }));
    const values = Object.values(out);
    // 営業等収入=5000000 / 青色控除=650000 / 事業所得=4350000
    expect(values).toContain('5000000');
    expect(values).toContain('650000');
    expect(values).toContain('4350000');
  });

  test('事業の3項目のみ。合計所得・所得控除・税額の欄は出力しない', () => {
    const out = mapKoa020LeafValues(ctx({ pl: { ...plBase }, aoiroDeductionKind: 'electronic' }));
    // 営業収入・事業所得・青色控除額 の 3 件のみ（合計⑫は e-Tax 自動計算）
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

  const emptyPersonalDeductions: Omit<IncomeDeductionInput, 'totalIncome'> = {
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
    // 336万円以下 → 基礎控除88万円
    expect(out.ABB00550).toBe('880000');
    expect(out.ABB00450).toBe('400000');
    // 事業所得=控除前300万−青色控除65万=235万、所得控除計=88万(基礎)+40万(社保)=128万
    expect(out.ABB00560).toBe('1280000');
    expect(out.ABB00580).toBe('1070000'); // 235万-128万
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
    // 235万300−128万=1,070,300 → (30)欄は千円未満切捨てで 1,070,000
    expect(out.ABB00580).toBe('1070000');
    expect(out.ABB00590).toBe('53500'); // 107万×5%
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
    const diffTax = Number(out.ABB00670);
    const saiSashihiki = Number(out.ABB01010);
    // 再差引所得税額は災害減免額のみ控除（外国税額控除は復興税算定後に控除するため含めない）
    expect(diffTax - saiSashihiki).toBe(2000);
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
    const taxAmount = Number(out.ABB00590);
    const foreignCredit = 10_000;
    // ABB01010（再差引）＝税額（外国税額控除は含めない）
    expect(Number(out.ABB01010)).toBe(taxAmount);
    // ABB01020（復興税）＝ABB01010×2.1%（1円未満切捨て）
    expect(Number(out.ABB01020)).toBe(Math.floor(taxAmount * 0.021));
    // ABB01030（合計）＝ABB01010＋ABB01020
    expect(Number(out.ABB01030)).toBe(Number(out.ABB01010) + Number(out.ABB01020));
    // ABB01040（外国税額控除の欄）は控除額そのものを維持
    expect(out.ABB01040).toBe('10000');
    // ABB00720（申告納税額）＝ABB01030 − 外国税額控除 − 源泉(0)
    expect(Number(out.ABB00720)).toBe(Number(out.ABB01030) - foreignCredit);
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
    expect(Number(out.ABB00720)).toBe(Number(out.ABB01030) - 35000);
  });

  test('給与所得・雑所得は合計所得金額（基礎控除の級距判定）にも加算される', () => {
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
    expect(out.ABB00550).toBe('680000');
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

describe('totalIncomeAmount / combinedTotalIncomeAmount（不動産所得との共有枠、B7 part2）', () => {
  const plBase = {
    year: 2026,
    revenue: [],
    expense: [],
    totalRevenue: '0',
    totalExpense: '0',
    netIncome: '0',
    entryCount: 0,
  };
  const emptyPersonalDeductions: Omit<IncomeDeductionInput, 'totalIncome'> = {
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
    expect(combinedTotalIncomeAmount(c).toString()).toBe('2350000');
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
    expect(combinedTotalIncomeAmount(c).toString()).toBe('8350000');
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
    expect(combinedTotalIncomeAmount(c).toString()).toBe('1650000');
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
  const emptyPersonalDeductions: Omit<IncomeDeductionInput, 'totalIncome'> = {
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
  const emptyPersonalDeductions: Omit<IncomeDeductionInput, 'totalIncome'> = {
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
    // 白色は青色申告特別控除が無いため事業所得＝控除前300万。合計所得300万→基礎控除88万
    expect(out.ABB00550).toBe('880000');
    expect(out.ABB00560).toBe('1280000'); // 88万(基礎)+40万(社保)
    expect(out.ABB00580).toBe('1720000'); // 300万-128万
    expect(out.ABB00590).toBe('86000'); // 172万×5%
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
});
