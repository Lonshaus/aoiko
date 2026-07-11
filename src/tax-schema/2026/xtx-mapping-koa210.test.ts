import { describe, expect, test } from 'vitest';
import { D } from '../../lib/decimal';
import { mapKoa210Values } from './xtx-mapping-koa210';
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

describe('mapKoa210Values 青色申告特別控除の充当（一般用44欄）', () => {
  test('不動産所得の黒字が先に控除枠を充当し、44欄は事業への配分残額のみ', () => {
    const out = mapKoa210Values(
      ctx({
        pl: {
          year: 2026,
          revenue: [],
          expense: [],
          totalRevenue: '0',
          totalExpense: '0',
          netIncome: '1044300',
          entryCount: 0,
        },
        aoiroDeductionKind: 'electronic',
        realEstatePl: realEstatePl('325000'),
        personalDeductions: {
          ...emptyPersonalDeductions,
          realEstateIncome: { businessScale: false },
        },
      })
    );
    // 控除枠65万を不動産所得32.5万が先に使い、事業への配分残は32.5万
    expect(out.AMF00500).toBe('1044300'); // 控除前所得
    expect(out.AMF00510).toBe('325000'); // 青色控除額（44欄）
    expect(out.AMF00530).toBe('719300'); // 所得金額
  });

  test('不動産所得が無ければ従来どおり単独の控除額を使う', () => {
    const out = mapKoa210Values(
      ctx({
        pl: {
          year: 2026,
          revenue: [],
          expense: [],
          totalRevenue: '0',
          totalExpense: '0',
          netIncome: '3000000',
          entryCount: 0,
        },
        aoiroDeductionKind: 'electronic',
      })
    );
    expect(out.AMF00500).toBe('3000000');
    expect(out.AMF00510).toBe('650000');
    expect(out.AMF00530).toBe('2350000');
  });
});