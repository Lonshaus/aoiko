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
      }),
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
      }),
    );
    expect(out.AMF00500).toBe('3000000');
    expect(out.AMF00510).toBe('650000');
    expect(out.AMF00530).toBe('2350000');
  });
});

describe('mapKoa210Values 貸借対照表（期末列への出力）', () => {
  const out = mapKoa210Values(
    ctx({
      bs: {
        year: 2026,
        asOf: '2026-12-31',
        assets: [
          {
            accountCode: '1110',
            accountName: '現金',
            category: 'asset' as const,
            balance: '100000',
          },
          {
            accountCode: '1130',
            accountName: '普通預金',
            category: 'asset' as const,
            balance: '500000',
          },
          {
            accountCode: '1510',
            accountName: '工具器具備品',
            category: 'asset' as const,
            balance: '300000',
          },
        ],
        liabilities: [
          {
            accountCode: '2110',
            accountName: '買掛金',
            category: 'liability' as const,
            balance: '80000',
          },
        ],
        equity: [
          {
            accountCode: '3110',
            accountName: '元入金',
            category: 'equity' as const,
            balance: '700000',
          },
        ],
        netIncome: '0',
        totalAssets: '900000',
        totalLiabilitiesAndEquity: '900000',
        balanced: true,
      },
    }),
  );
  test('期末残高は期末ブランチの tag に入る', () => {
    expect(out.AMG00260).toBe('100000'); // 現金（期末）
    expect(out.AMG00290).toBe('500000'); // その他の預金（期末、普通預金の別名）
    expect(out.AMG00400).toBe('300000'); // 工具器具備品（期末）
    expect(out.AMG00650).toBe('80000'); // 買掛金（期末）
  });
  test('期首ブランチの tag には出力しない', () => {
    expect(out.AMG00060).toBeUndefined(); // 現金（期首）
    expect(out.AMG00090).toBeUndefined(); // その他の預金（期首）
    expect(out.AMG00200).toBeUndefined(); // 工具器具備品（期首）
    expect(out.AMG00520).toBeUndefined(); // 買掛金（期首）
  });
  test('元入金のみ期首・期末の両方に同額を出力（手引き 一般用の書き方 p.6）', () => {
    expect(out.AMG00740).toBe('700000'); // 元入金（期末）
    expect(out.AMG00600).toBe('700000'); // 元入金（期首）
  });
});
