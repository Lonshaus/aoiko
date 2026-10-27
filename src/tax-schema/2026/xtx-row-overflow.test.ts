import { describe, expect, test } from 'vitest';
import { D } from '../../lib/decimal';
import { buildXtx2026, personalDeductionsToCtx, xtxRowOverflow, type XtxContext } from './xtx';
import type { FixedAsset } from '../../db/types';
import type { PLReport } from '../../domain/reports';

function pl(netIncome: string): PLReport {
  return {
    year: 2026,
    revenue: [],
    expense: [],
    totalRevenue: netIncome,
    totalExpense: '0',
    netIncome,
    entryCount: 1,
  };
}

function ctx(overrides: Partial<XtxContext> = {}): XtxContext {
  return {
    year: 2026,
    businessName: 'テスト商店',
    invoiceNumber: '',
    monthly: { year: 2026, months: [], totalSales: '0', totalExpense: '0' },
    pl: pl('5000000'),
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
      address: '東京都武蔵野市1-2-3',
      zeimushoCode: '01101',
      zeimushoName: '麹町',
    },
    filingType: 'blue',
    aoiroDeductionKind: 'electronic',
    fixedAssets: [],
    ...overrides,
  };
}

function assets(count: number, extra: Partial<FixedAsset> = {}): FixedAsset[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `a${String(i).padStart(2, '0')}`,
    name: `資産${i + 1}`,
    acquisitionDate: `2025-01-${String(i + 1).padStart(2, '0')}`,
    acquisitionCost: '400000',
    usefulLifeYears: 4,
    depreciationMethod: 'straight-line' as const,
    accountCode: '1510',
    ...extra,
  }));
}

function deductions(extra: Record<string, unknown>): NonNullable<XtxContext['personalDeductions']> {
  return personalDeductionsToCtx({
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
    ...extra,
  } as never);
}

describe('明細欄の行数を超えた項目（R17）', () => {
  test('青色の減価償却明細は 7 行。8 件目は書かずに名前と償却額を返し、出力は止めない', () => {
    const c = ctx({ fixedAssets: assets(8) });
    const overflow = xtxRowOverflow(c);
    expect(overflow.map((o) => o.name)).toEqual(['資産8']);
    expect(D(overflow[0]!.amount).isPositive()).toBe(true);
    expect(() => buildXtx2026(c)).not.toThrow();
  });

  test('白色の減価償却明細は 6 行', () => {
    const overflow = xtxRowOverflow(ctx({ filingType: 'white', fixedAssets: assets(7) }));
    expect(overflow.map((o) => o.name)).toEqual(['資産7']);
  });

  test('行数以内なら何も返さない', () => {
    expect(xtxRowOverflow(ctx({ fixedAssets: assets(7) }))).toEqual([]);
  });

  test('不動産の物件は 15 行・減価償却明細は 13 行まで', () => {
    const fixedAssets = assets(16, {
      incomeType: 'realEstate',
      realEstateDetail: { propertyType: '住宅', address: '東京', annualRent: '1200000' },
    });
    const overflow = xtxRowOverflow(
      ctx({
        fixedAssets,
        realEstatePl: pl('1000000'),
        personalDeductions: deductions({ realEstateIncome: { businessScale: true } }),
      }),
    );
    expect(overflow.filter((o) => o.amount === '1200000').map((o) => o.name)).toEqual(['資産16']);
    expect(overflow.filter((o) => o.amount !== '1200000').map((o) => o.name)).toEqual([
      '資産14',
      '資産15',
      '資産16',
    ]);
  });

  test('支払先の明細（地代家賃は 2 行）を超えた分を返す', () => {
    const overflow = xtxRowOverflow(
      ctx({
        realEstatePl: pl('1000000'),
        personalDeductions: deductions({
          realEstateIncome: {
            businessScale: true,
            rentPaid: [
              { amount: '1000', payeeName: 'A' },
              { amount: '2000', payeeName: 'B' },
              { amount: '3000', payeeName: 'C' },
            ],
          },
        }),
      }),
    );
    expect(overflow).toEqual([{ name: 'C', amount: '3000' }]);
  });

  test('申告書第二表の専従者は 2 行まで', () => {
    const employee = (i: number) => ({
      id: `f${i}`,
      name: `専従者${i}`,
      relation: 'other' as const,
      age: 30,
      monthsWorked: 12,
    });
    const overflow = xtxRowOverflow(
      ctx({
        filingType: 'white',
        personalDeductions: deductions({
          familyEmployees: [employee(1), employee(2), employee(3)],
        }),
      }),
    );
    expect(overflow.map((o) => o.name)).toEqual(['専従者3']);
  });
});

describe('旧い書き方の取得価額（R10）', () => {
  test('取得価額 0x3e8 の資産は .xtx に 1000 として書く', () => {
    const xml = buildXtx2026(ctx({ fixedAssets: assets(1, { acquisitionCost: '0x3e8' }) }));
    expect(xml).toContain('<AMF01640>1000</AMF01640>');
  });
});
