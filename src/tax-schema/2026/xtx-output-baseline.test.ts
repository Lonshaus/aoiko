/// <reference types="node" />
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test, vi } from 'vitest';
// 作成日は端末の時刻と時差で決まるため、どの時差でも同じ日になるよう日付そのものを固定する
vi.mock('../../lib/date', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/date')>()),
  todayISO: () => '2027-01-04',
}));
import { buildXtx2026, personalDeductionsToCtx, type XtxContext } from './xtx';
import { buildGeneralXtx, buildSimplifiedXtx, buildTwoWariXtx } from './xtx-consumption-tax';
import type { BSReport, MonthlyReport, PLReport } from '../../domain/reports';
import type { PersonalDeductionInput } from '../../db/types';
import { D } from '../../lib/decimal';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, 'xtx-output-baseline.fixture.json');
const WRITE_MODE = process.env.XTX_BASELINE_WRITE === '1';

function makeCtx(): XtxContext {
  const monthly: MonthlyReport = {
    year: 2026,
    months: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      sales: '0',
      expense: '0',
      purchases: '0',
    })),
    totalSales: '0',
    totalExpense: '0',
  };
  const pl: PLReport = {
    year: 2026,
    revenue: [],
    expense: [],
    totalRevenue: '0',
    totalExpense: '0',
    netIncome: '0',
    entryCount: 0,
  };
  const bs: BSReport = {
    year: 2026,
    asOf: '2026-12-31',
    assets: [],
    liabilities: [],
    equity: [],
    netIncome: '0',
    totalAssets: '0',
    totalLiabilitiesAndEquity: '0',
    balanced: true,
  };
  return {
    year: 2026,
    businessName: 'aoikoウェブ事務所',
    invoiceNumber: 'T1234567890123',
    monthly,
    pl,
    bs,
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
  };
}

function storedWith(
  overrides: Partial<Omit<PersonalDeductionInput, 'year' | 'updatedAt'>>,
): Omit<PersonalDeductionInput, 'year' | 'updatedAt'> {
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

function realEstateRows(): Omit<PersonalDeductionInput, 'year' | 'updatedAt'> {
  return storedWith({
    realEstateIncome: {
      businessScale: true,
      landLoanInterestAmount: '-5000',
      rentPaid: [{ payeeName: '地主', amount: '５，０００', deductibleAmount: '-5000' }],
      loanInterestPaid: [
        {
          payeeName: '銀行',
          amount: '-5000',
          deductibleAmount: '',
          yearEndBalance: '１２３，４５６',
        },
      ],
      professionalFeesPaid: [
        {
          payeeName: '税理士',
          amount: ' 3,000 ',
          withholdingTax: '－306',
          deductibleAmount: 'abc',
        },
      ],
    },
  });
}

function realEstateCtx(filingType: 'blue' | 'white'): XtxContext {
  const ctx = makeCtx();
  ctx.filingType = filingType;
  ctx.realEstatePl = {
    year: 2026,
    revenue: [
      {
        accountCode: '4210',
        accountName: '賃貸料（不動産）',
        category: 'revenue',
        amount: '1000000',
        displayOrder: 210,
      },
    ],
    expense: [],
    totalRevenue: '1000000',
    totalExpense: '0',
    netIncome: '1000000',
    entryCount: 1,
  };
  ctx.personalDeductions = personalDeductionsToCtx(realEstateRows());
  return ctx;
}

const filer = {
  riyoshaId: '1234567890123456',
  name: '青井 太郎',
  zip: '1800001',
  address: '東京都武蔵野市〇〇1-2-3',
  zeimushoCode: '01101',
  zeimushoName: '麹町',
};

function badDebtZeroExtras() {
  return {
    badDebtTax10: D('0'),
    badDebtTax8: D('0'),
    badDebtRecoveryTax10: D('0'),
    badDebtRecoveryTax8: D('0'),
  };
}

function zeroExtras() {
  return {
    exportExemptSalesBase: D('0'),
    nonTaxableSalesBase: D('0'),
    inputCommon10: D('0'),
    inputCommon8: D('0'),
    inputNonTaxableOnly10: D('0'),
    inputNonTaxableOnly8: D('0'),
    importTax10: D('0'),
    importTax8: D('0'),
    reverseChargeBase: D('0'),
    reverseChargeTax: D('0'),
    reverseChargeCommonTax: D('0'),
    reverseChargeNonTaxableOnlyTax: D('0'),
    attributionMethod: 'proportional' as const,
    ...badDebtZeroExtras(),
  };
}

const interimPeriod = { start: '2026-07-01', end: '2026-09-30' };

interface Scenario {
  build: () => string;
  mustContain?: string[];
}

const SCENARIOS: Record<string, Scenario> = {
  'income-blue-business-only': { build: () => buildXtx2026(makeCtx()) },
  'income-white-business-only': {
    build: () => {
      const ctx = makeCtx();
      ctx.filingType = 'white';
      return buildXtx2026(ctx);
    },
  },
  'income-blue-with-real-estate': { build: () => buildXtx2026(realEstateCtx('blue')) },
  'income-white-with-real-estate': { build: () => buildXtx2026(realEstateCtx('white')) },
  'consumption-two-wari': {
    build: () =>
      buildTwoWariXtx({
        year: 2026,
        businessName: 'aoikoウェブ事務所',
        filer,
        taxableBase10: D('6008481'),
        taxableBase8: D('0'),
        ...badDebtZeroExtras(),
      }),
    mustContain: ['ABY00000'],
  },
  'consumption-simplified-single-category': {
    build: () =>
      buildSimplifiedXtx({
        year: 2026,
        businessName: 'aoikoウェブ事務所',
        filer,
        taxableBase10: D('2000000'),
        taxableBase8: D('0'),
        category: 5,
        deemedInputRate: 0.5,
        interimPeriod,
        ...badDebtZeroExtras(),
      }),
    mustContain: ['DVC00010', 'ABH00160'],
  },
  'consumption-simplified-special-calc': {
    build: () =>
      buildSimplifiedXtx({
        year: 2026,
        businessName: 'aoikoウェブ事務所',
        filer,
        taxableBase10: D('10100000'),
        taxableBase8: D('0'),
        category: 1,
        deemedInputRate: 0.9,
        markedTransferBase10: D('100000'),
        markedTransferBase8: D('0'),
        interimPeriod,
        ...badDebtZeroExtras(),
      }),
    mustContain: ['ABL00210', 'DVE00070', 'ABH00160'],
  },
  'consumption-general': {
    build: () =>
      buildGeneralXtx({
        year: 2026,
        businessName: 'aoikoウェブ事務所',
        filer,
        taxableBase10: D('3000000'),
        taxableBase8: D('0'),
        input10: D('100000'),
        input8: D('0'),
        interimPeriod,
        ...zeroExtras(),
      }),
    mustContain: ['AAI00160'],
  },
};

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

describe('.xtx 出力基準（届出事項ブロックの追加前後でバイト不変であることの確認）', () => {
  const hashes: Record<string, string> = {};
  const fixture: Record<string, string> = WRITE_MODE
    ? {}
    : (JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Record<string, string>);

  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    test(name, () => {
      const xml = scenario.build();
      for (const tag of scenario.mustContain ?? []) {
        expect(xml).toContain(`<${tag}>`);
      }
      hashes[name] = sha256(xml);
      if (!WRITE_MODE) {
        expect(hashes[name]).toBe(fixture[name]);
      }
    });
  }

  test.runIf(WRITE_MODE)('fixture を書き出す', () => {
    writeFileSync(FIXTURE_PATH, JSON.stringify(hashes, null, 2) + '\n');
  });

  test.skipIf(WRITE_MODE)('fixture のシナリオ集合が一致する', () => {
    expect(Object.keys(fixture).sort()).toEqual(Object.keys(SCENARIOS).sort());
  });
});
