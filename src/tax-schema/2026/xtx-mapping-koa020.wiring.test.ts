import { describe, expect, test, vi } from 'vitest';
import { D } from '../../lib/decimal';
import type { XtxContext } from './xtx';
// 3 種類の金額に別々の値を返させ、各所得控除と課税総所得金額がどの金額を読むかを見分ける
vi.mock('./general-income', async (importOriginal) => {
  const original = await importOriginal<typeof import('./general-income')>();
  return {
    ...original,
    legalTotalIncomeAmount: () => D(4_890_001),
    totalIncomeAmountEtc: () => D(1_000_000),
    aggregateIncomeAmount: () => D(3_000_000),
  };
});

const { mapKoa020LeafValues } = await import('./xtx-mapping-koa020');

function ctx(): XtxContext {
  return {
    year: 2026,
    businessName: 'aoiko',
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
      address: '東京都',
      zeimushoCode: '01101',
      zeimushoName: '麹町',
    },
    filingType: 'blue',
    aoiroDeductionKind: 'electronic',
    fixedAssets: [],
    personalDeductions: {
      socialInsurancePaid: D(400_000),
      smallBusinessMutualAidPaid: D(0),
      lifeInsurance: {},
      earthquakeInsurancePaid: D(0),
      oldLongTermInsurancePaid: D(0),
      medicalExpensePaid: D(150_000),
      medicalInsuranceReimbursement: D(0),
      donationAmount: D(0),
      casualtyLossDeduction: D(0),
      isDisabled: false,
      isSpecialDisabled: false,
      isSingleParent: true,
      isWidow: false,
      isWorkingStudent: false,
      dependents: [],
    },
  };
}

describe('合計所得金額・総所得金額等・総所得金額の接続先', () => {
  const out = mapKoa020LeafValues(ctx());

  test('基礎控除とひとり親控除の判定は合計所得金額を読む（489 万円超→基礎控除 67 万円・ひとり親 35 万円）', () => {
    expect(out.ABB00550).toBe('670000');
    expect(out.ABB00500).toBe('350000');
  });

  test('医療費控除は総所得金額等を読む（100 万円の 5％＝5 万円を引く→10 万円）', () => {
    expect(out.ABB00440).toBe('100000');
  });

  test('課税される所得金額は総所得金額から所得控除を引く', () => {
    // 総所得金額 300 万円 − (基礎 67 万円 + ひとり親 35 万円 + 社会保険料 40 万円 + 医療費 10 万円)
    expect(out.ABB00580).toBe('1480000');
  });

  test('公的年金等以外の合計所得金額 ABB00775 は合計所得金額', () => {
    expect(out.ABB00775).toBe('4890001');
  });
});
