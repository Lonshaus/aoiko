import { describe, expect, test } from 'vitest';
import { D } from '../../lib/decimal';
import { mapKoa220RepeatedValues, mapKoa220Values } from './xtx-mapping-koa220';
import type { XtxContext } from './xtx';
import type { FixedAsset } from '../../db/types';
import type { PLReport } from '../../domain/reports';
import type { RealEstateIncomeCtx } from './real-estate-income';

// personalDeductions は Omit<IncomeDeductionInput,'totalIncome'> & TaxCreditInput &
// OtherIncomeInput & { realEstateIncome? } の交差型のため、realEstateIncome だけの
// 部分オブジェクトは型を満たさない。IncomeDeductionInput 側の必須項目を補ったヘルパー。
function withRealEstate(realEstateIncome: RealEstateIncomeCtx): NonNullable<XtxContext['personalDeductions']> {
  return {
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
    realEstateIncome,
  };
}

function realEstatePl(overrides: Partial<PLReport> = {}): PLReport {
  return {
    year: 2026,
    revenue: [],
    expense: [],
    totalRevenue: '0',
    totalExpense: '0',
    netIncome: '0',
    entryCount: 0,
    ...overrides,
  };
}

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
      riyoshaId: '',
      name: '',
      zip: '',
      address: '',
      zeimushoCode: '',
      zeimushoName: '',
    },
    filingType: 'blue',
    aoiroDeductionKind: 'electronic',
    fixedAssets: [],
    ...overrides,
  };
}

describe('mapKoa220Values（青色申告決算書・不動産所得用 第1頁）', () => {
  test('realEstatePl が無ければ空を返す', () => {
    expect(mapKoa220Values(ctx())).toEqual({});
  });

  test('賃貸料・必要経費・所得金額を対映する', () => {
    const out = mapKoa220Values(
      ctx({
        realEstatePl: realEstatePl({
          revenue: [
            { accountCode: '4210', accountName: '賃貸料（不動産）', category: 'revenue', amount: '1200000', displayOrder: 210 },
          ],
          expense: [
            { accountCode: '5320', accountName: '損害保険料（不動産）', category: 'expense', amount: '50000', displayOrder: 1320 },
          ],
          totalRevenue: '1200000',
          totalExpense: '50000',
          netIncome: '1150000',
        }),
        personalDeductions: withRealEstate({ businessScale: true }),
      })
    );
    const values = Object.values(out);
    expect(values).toContain('1200000'); // 賃貸料
    expect(values).toContain('50000'); // 損害保険料
    expect(values).toContain('1150000'); // 差引金額
  });

  test('青色申告特別控除は事業所得との共有枠配分後の額を使う', () => {
    const out = mapKoa220Values(
      ctx({
        pl: {
          year: 2026,
          revenue: [],
          expense: [],
          totalRevenue: '0',
          totalExpense: '0',
          netIncome: '5000000',
          entryCount: 0,
        },
        realEstatePl: realEstatePl({ netIncome: '4000000' }),
        personalDeductions: withRealEstate({ businessScale: false }),
      })
    );
    // 限度額65万を不動産所得から優先控除→65万使い切り、所得金額=400万-65万=335万
    expect(out.ANF00270).toBe('3350000');
    expect(out.ANF00260).toBe('650000');
  });

  test('土地等取得の負債利子額を確定額のまま出力する', () => {
    const out = mapKoa220Values(
      ctx({
        realEstatePl: realEstatePl({ netIncome: '-100000' }),
        personalDeductions: withRealEstate({ businessScale: true, landLoanInterestAmount: D(30000) }),
      })
    );
    expect(out.ANF00280).toBe('30000');
  });
});

describe('mapKoa220RepeatedValues（第2〜3頁の繰り返しブロック）', () => {
  function realEstateAsset(overrides: Partial<FixedAsset> = {}): FixedAsset {
    return {
      id: 'a1',
      name: '賃貸マンション',
      acquisitionDate: '2020-01-01',
      acquisitionCost: '10000000',
      usefulLifeYears: 22,
      depreciationMethod: 'straight-line',
      accountCode: '1511',
      incomeType: 'realEstate',
      ...overrides,
    };
  }

  test('物件明細（ANF00340）は realEstateDetail を持つ資産から生成する', () => {
    const repeats = mapKoa220RepeatedValues(
      ctx({
        fixedAssets: [
          realEstateAsset({
            realEstateDetail: {
              propertyType: '貸家',
              address: '東京都武蔵野市〇〇1-2-3',
              annualRent: '1200000',
            },
          }),
        ],
      })
    );
    expect(repeats.ANF00340).toHaveLength(1);
    expect(repeats.ANF00340?.[0]?.ANF00360).toBe('東京都武蔵野市〇〇1-2-3');
    expect(repeats.ANF00340?.[0]?.ANF00500).toBe('1200000');
  });

  test('incomeType business の資産は物件明細に含めない', () => {
    const repeats = mapKoa220RepeatedValues(
      ctx({
        fixedAssets: [realEstateAsset({ incomeType: 'business', realEstateDetail: { propertyType: '貸家', address: 'X', annualRent: '1' } })],
      })
    );
    expect(repeats.ANF00340).toBeUndefined();
  });

  test('減価償却明細（ANF00890）は incomeType: realEstate の資産のみ含める', () => {
    const repeats = mapKoa220RepeatedValues(
      ctx({
        fixedAssets: [
          realEstateAsset(),
          { ...realEstateAsset({ id: 'a2', incomeType: 'business', name: '事業用PC' }) },
        ],
      })
    );
    expect(repeats.ANF00890).toHaveLength(1);
    expect(repeats.ANF00890?.[0]?.ANF00900).toBe('賃貸マンション');
  });

  test('地代家賃の内訳（ANF01160）は公式上限2件で切り詰める', () => {
    const rentPaid: RealEstateIncomeCtx['rentPaid'] = [
      { amount: '1000', payeeName: 'A' },
      { amount: '2000', payeeName: 'B' },
      { amount: '3000', payeeName: 'C' },
    ];
    const repeats = mapKoa220RepeatedValues(
      ctx({ personalDeductions: withRealEstate({ businessScale: true, rentPaid }) })
    );
    expect(repeats.ANF01160).toHaveLength(2);
    expect(repeats.ANF01160?.[0]?.ANF01190).toBe('A');
  });

  test('借入金利子の内訳（ANF01260）は期末残高も対映する', () => {
    const loanInterestPaid: RealEstateIncomeCtx['loanInterestPaid'] = [
      { amount: '5000', payeeName: '〇〇銀行', yearEndBalance: '9000000' },
    ];
    const repeats = mapKoa220RepeatedValues(
      ctx({ personalDeductions: withRealEstate({ businessScale: true, loanInterestPaid }) })
    );
    expect(repeats.ANF01260?.[0]?.ANF01300).toBe('9000000');
    expect(repeats.ANF01260?.[0]?.ANF01310).toBe('5000');
  });

  test('専用欄の無い経費科目（貸倒金・貸倒引当金繰入額）は追加科目（ANF00195）へ出力する', () => {
    const repeats = mapKoa220RepeatedValues(
      ctx({
        realEstatePl: realEstatePl({
          expense: [
            { accountCode: '5400', accountName: '貸倒金（不動産）', category: 'expense', amount: '30000', displayOrder: 1385 },
            { accountCode: '5410', accountName: '貸倒引当金繰入額（不動産）', category: 'expense', amount: '20000', displayOrder: 1395 },
          ],
        }),
      })
    );
    expect(repeats.ANF00195).toHaveLength(2);
    expect(repeats.ANF00195?.[0]?.ANF00060).toBe('貸倒金');
    expect(repeats.ANF00195?.[0]?.ANF00200).toBe('30000');
    expect(repeats.ANF00195?.[1]?.ANF00060).toBe('貸倒引当金繰入額');
  });

  test('専用欄がある経費科目（損害保険料等）は追加科目に重複して出さない', () => {
    const repeats = mapKoa220RepeatedValues(
      ctx({
        realEstatePl: realEstatePl({
          expense: [
            { accountCode: '5320', accountName: '損害保険料（不動産）', category: 'expense', amount: '50000', displayOrder: 1320 },
          ],
        }),
      })
    );
    expect(repeats.ANF00195).toBeUndefined();
  });

  test('追加科目は公式上限5件で切り詰める', () => {
    const expense: PLReport['expense'] = Array.from({ length: 7 }, (_, i) => ({
      accountCode: `9${i}`,
      accountName: `未対応科目${i}（不動産）`,
      category: 'expense' as const,
      amount: '1000',
      displayOrder: i,
    }));
    const repeats = mapKoa220RepeatedValues(ctx({ realEstatePl: realEstatePl({ expense }) }));
    expect(repeats.ANF00195).toHaveLength(5);
  });
});