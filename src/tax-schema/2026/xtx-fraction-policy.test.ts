import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../../db/db';
import { toIndexable } from '../../lib/decimal';
import { processYear } from '../../domain/consumption-tax';
import type { FixedAsset } from '../../db/types';
import type { PLReport } from '../../domain/reports';
import { ACCOUNTS_2026 } from './accounts';
import { buildGeneralXtx, buildTwoWariXtx } from './xtx-consumption-tax';
import { hasInvalidXtxAmounts } from './xtx-amount-check';
import { buildXtx2026, personalDeductionsToCtx, type XtxContext } from './xtx';

const FILER = {
  riyoshaId: '1234567890123456',
  name: '青井 太郎',
  zip: '1800001',
  address: '東京都武蔵野市1-2-3',
  zeimushoCode: '01101',
  zeimushoName: '麹町',
};

async function seedTaxIncludedSale(): Promise<void> {
  await db.journalEntries.add({
    id: 'e1',
    date: '2026-04-01',
    year: 2026,
    description: 'テスト',
    status: 'confirmed',
    source: 'manual',
    createdAt: 0,
    confirmedAt: 0,
  });
  await db.journalLines.bulkAdd([
    {
      id: 'd',
      entryId: 'e1',
      side: 'debit',
      accountCode: '1130',
      amount: '1000001',
      amountIndexed: toIndexable('1000001'),
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
    },
    {
      id: 'c',
      entryId: 'e1',
      side: 'credit',
      accountCode: '4110',
      amount: '1000001',
      amountIndexed: toIndexable('1000001'),
      taxRate: 0.1,
      taxIncluded: true,
      invoiceCompliant: true,
    },
  ]);
}

function storedDeductions(socialInsurancePaid: string) {
  return {
    year: 2026,
    socialInsurancePaid,
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
    updatedAt: 0,
  } as never;
}

function incomeCtx(socialInsurancePaid: string): XtxContext {
  const pl: PLReport = {
    year: 2026,
    revenue: [],
    expense: [],
    totalRevenue: '5000000',
    totalExpense: '0',
    netIncome: '5000000',
    entryCount: 1,
  };
  return {
    year: 2026,
    businessName: 'テスト商店',
    invoiceNumber: '',
    monthly: { year: 2026, months: [], totalSales: '0', totalExpense: '0' },
    pl,
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
    filer: FILER,
    filingType: 'blue',
    aoiroDeductionKind: 'electronic',
    fixedAssets: [] as FixedAsset[],
    personalDeductions: personalDeductionsToCtx(storedDeductions(socialInsurancePaid)),
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.accounts.bulkAdd(ACCOUNTS_2026);
});

afterEach(async () => {
  await db.delete();
});

describe('小数を含む金額の .xtx の扱い', () => {
  test('課税売上の税抜額に小数が出る仕訳から、2割特例と本則課税の .xtx を最後まで出力できる', async () => {
    await seedTaxIncludedSale();
    const processed = await processYear(2026);
    expect(processed.taxableBase10.isInteger()).toBe(false);

    const common = {
      year: 2026,
      businessName: 'テスト商店',
      filer: FILER,
      taxableBase10: processed.taxableBase10,
      taxableBase8: processed.taxableBase8,
      badDebtTax10: processed.badDebtTax10,
      badDebtTax8: processed.badDebtTax8,
      badDebtRecoveryTax10: processed.badDebtRecoveryTax10,
      badDebtRecoveryTax8: processed.badDebtRecoveryTax8,
    };
    expect(() => buildTwoWariXtx(common)).not.toThrow();
    expect(() =>
      buildGeneralXtx({
        ...common,
        input10: processed.input10,
        input8: processed.input8,
        exportExemptSalesBase: processed.exportExemptSalesBase,
        nonTaxableSalesBase: processed.nonTaxableSalesBase,
        inputCommon10: processed.inputCommon10,
        inputCommon8: processed.inputCommon8,
        inputNonTaxableOnly10: processed.inputNonTaxableOnly10,
        inputNonTaxableOnly8: processed.inputNonTaxableOnly8,
        importTax10: processed.importTax10,
        importTax8: processed.importTax8,
        reverseChargeBase: processed.reverseChargeBase,
        reverseChargeTax: processed.reverseChargeTax,
        reverseChargeCommonTax: processed.reverseChargeCommonTax,
        reverseChargeNonTaxableOnlyTax: processed.reverseChargeNonTaxableOnlyTax,
        attributionMethod: 'proportional',
      }),
    ).not.toThrow();
  });

  test('保存した所得控除が 100.5 なら止め、100 なら止めない', () => {
    expect(hasInvalidXtxAmounts(storedDeductions('100.5'), [], false)).toBe(true);
    expect(hasInvalidXtxAmounts(storedDeductions('100'), [], false)).toBe(false);
    expect(() => buildXtx2026(incomeCtx('100'))).not.toThrow();
  });
});
