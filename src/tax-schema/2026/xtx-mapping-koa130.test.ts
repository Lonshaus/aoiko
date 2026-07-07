import { describe, expect, test } from 'vitest';
import { D } from '../../lib/decimal';
import { mapKoa130RepeatedValues, mapKoa130Values } from './xtx-mapping-koa130';
import type { XtxContext } from './xtx';
import type { RealEstateIncomeCtx } from './real-estate-income';
import type { FixedAsset } from '../../db/types';
import type { PLReport } from '../../domain/reports';

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
    filingType: 'white',
    aoiroDeductionKind: 'none',
    fixedAssets: [],
    ...overrides,
  };
}

describe('mapKoa130Values（収支内訳書・不動産所得用 第1頁）', () => {
  test('realEstatePl が無ければ空を返す', () => {
    expect(mapKoa130Values(ctx())).toEqual({});
  });

  test('専従者給与（不動産）は businessScale に関わらず全額不算入で加算し戻す', () => {
    const out = mapKoa130Values(
      ctx({
        realEstatePl: realEstatePl({
          expense: [
            { accountCode: '5380', accountName: '専従者給与（不動産）', category: 'expense', amount: '300000', displayOrder: 1380 },
          ],
          totalExpense: '300000',
          netIncome: '700000',
        }),
        personalDeductions: withRealEstate({ businessScale: true }),
      })
    );
    // netIncome 70万 + 専従者給与30万（白色は事業的規模に関わらず全額不算入）= 100万
    expect(out.AKG00230).toBe('1000000');
  });

  test('貸倒金（不動産）は AKG00120 へ対映する', () => {
    const out = mapKoa130Values(
      ctx({
        realEstatePl: realEstatePl({
          expense: [
            { accountCode: '5400', accountName: '貸倒金（不動産）', category: 'expense', amount: '40000', displayOrder: 1385 },
          ],
        }),
      })
    );
    expect(out.AKG00120).toBe('40000');
  });

  test('貸倒引当金繰入額（不動産）は白色に引当金制度が無いため出力しない', () => {
    const out = mapKoa130Values(
      ctx({
        realEstatePl: realEstatePl({
          expense: [
            { accountCode: '5410', accountName: '貸倒引当金繰入額（不動産）', category: 'expense', amount: '10000', displayOrder: 1395 },
          ],
        }),
      })
    );
    expect(Object.values(out)).not.toContain('10000');
  });

  test('土地等取得の負債利子額を確定額のまま出力する', () => {
    const out = mapKoa130Values(
      ctx({
        realEstatePl: realEstatePl({ netIncome: '-50000' }),
        personalDeductions: withRealEstate({ businessScale: false, landLoanInterestAmount: D(20000) }),
      })
    );
    expect(out.AKG00260).toBe('20000');
  });
});

describe('mapKoa130RepeatedValues（第2頁の繰り返しブロック）', () => {
  function realEstateAsset(overrides: Partial<FixedAsset> = {}): FixedAsset {
    return {
      id: 'a1',
      name: '賃貸アパート',
      acquisitionDate: '2021-04-01',
      acquisitionCost: '8000000',
      usefulLifeYears: 22,
      depreciationMethod: 'straight-line',
      accountCode: '1511',
      incomeType: 'realEstate',
      ...overrides,
    };
  }

  test('物件明細（AKH00010）は realEstateDetail を持つ資産から生成する', () => {
    const repeats = mapKoa130RepeatedValues(
      ctx({
        fixedAssets: [
          realEstateAsset({
            realEstateDetail: { propertyType: '貸家', address: '東京都〇〇区', annualRent: '960000' },
          }),
        ],
      })
    );
    expect(repeats.AKH00010).toHaveLength(1);
    expect(repeats.AKH00010?.[0]?.AKH00030).toBe('東京都〇〇区');
    expect(repeats.AKH00010?.[0]?.AKH00170).toBe('960000');
  });

  test('減価償却明細（AKK00010）は incomeType: realEstate の資産のみ含める', () => {
    const repeats = mapKoa130RepeatedValues(
      ctx({
        fixedAssets: [realEstateAsset(), realEstateAsset({ id: 'a2', incomeType: 'business', name: '事業用車両' })],
      })
    );
    expect(repeats.AKK00010).toHaveLength(1);
    expect(repeats.AKK00010?.[0]?.AKK00020).toBe('賃貸アパート');
  });

  test('借入金利子の内訳（AKL00000）は公式上限2件で切り詰める', () => {
    const repeats = mapKoa130RepeatedValues(
      ctx({
        personalDeductions: withRealEstate({
          businessScale: true,
          loanInterestPaid: [
            { amount: '1000', payeeName: 'A' },
            { amount: '2000', payeeName: 'B' },
            { amount: '3000', payeeName: 'C' },
          ],
        }),
      })
    );
    expect(repeats.AKL00000).toHaveLength(2);
  });
});