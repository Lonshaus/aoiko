import { describe, expect, test } from 'vitest';
import { D } from '../../lib/decimal';
import { mapKoa130RepeatedValues, mapKoa130Values } from './xtx-mapping-koa130';
import type { XtxContext } from './xtx';
import type { FixedAsset, PLReport } from '../../db/types';

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
        personalDeductions: { realEstateIncome: { businessScale: true } },
      })
    );
    // netIncome 70万 + 専従者給与30万（白色は事業的規模に関わらず全額不算入）= 100万
    expect(out.AKG00230).toBe('1000000');
  });

  test('土地等取得の負債利子額を確定額のまま出力する', () => {
    const out = mapKoa130Values(
      ctx({
        realEstatePl: realEstatePl({ netIncome: '-50000' }),
        personalDeductions: { realEstateIncome: { businessScale: false, landLoanInterestAmount: D(20000) } },
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
        personalDeductions: {
          realEstateIncome: {
            businessScale: true,
            loanInterestPaid: [
              { amount: '1000', payeeName: 'A' },
              { amount: '2000', payeeName: 'B' },
              { amount: '3000', payeeName: 'C' },
            ],
          },
        },
      })
    );
    expect(repeats.AKL00000).toHaveLength(2);
  });
});