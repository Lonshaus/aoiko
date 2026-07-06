import { describe, expect, test } from 'vitest';
import { D } from '../../lib/decimal';
import { mapKoa020LeafValues, mapKoa020Values } from './xtx-mapping-koa020';
import type { XtxContext } from './xtx';
import type { IncomeDeductionInput } from './income-deductions';

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
    const out = mapKoa020LeafValues(
      ctx({ pl: { ...plBase }, aoiroDeductionKind: 'electronic' })
    );
    const values = Object.values(out);
    // 営業等収入=5000000 / 青色控除=650000 / 事業所得=4350000
    expect(values).toContain('5000000');
    expect(values).toContain('650000');
    expect(values).toContain('4350000');
  });

  test('事業の3項目のみ。合計所得・所得控除・税額の欄は出力しない', () => {
    const out = mapKoa020LeafValues(
      ctx({ pl: { ...plBase }, aoiroDeductionKind: 'electronic' })
    );
    // 営業収入・事業所得・青色控除額 の 3 件のみ（合計⑫は e-Tax 自動計算）
    expect(Object.keys(out)).toHaveLength(3);
  });

  test('簡易簿記(10万控除)なら事業所得=控除前−10万', () => {
    const out = mapKoa020LeafValues(
      ctx({ pl: { ...plBase, netIncome: '2000000' }, aoiroDeductionKind: 'simple' })
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
      })
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

  test('personalDeductions 未入力なら所得控除・税額の欄は出力しない', () => {
    const out = mapKoa020LeafValues(
      ctx({ pl: { ...plBase, netIncome: '3000000' }, aoiroDeductionKind: 'electronic' })
    );
    expect(out.ABB00550).toBeUndefined();
    expect(out.ABB00590).toBeUndefined();
  });

  test('税額控除は差引所得税額算出後、外国税額控除等・災害減免額は再差引で別枠控除', () => {
    const out = mapKoa020LeafValues(
      ctx({
        pl: { ...plBase, netIncome: '10000000' },
        aoiroDeductionKind: 'electronic',
        personalDeductions: {
          ...emptyPersonalDeductions,
          foreignTaxCreditAmount: D(1000),
          disasterExemptionAmount: D(2000),
        },
      })
    );
    const diffTax = Number(out.ABB00670);
    const saiSashihiki = Number(out.ABB01010);
    expect(diffTax - saiSashihiki).toBe(3000);
  });
});