import { describe, expect, test } from 'vitest';
import { mapKoa020LeafValues, mapKoa020Values } from './xtx-mapping-koa020';
import type { XtxContext } from './xtx';

function ctx(overrides: Partial<XtxContext> = {}): XtxContext {
  return {
    year: 2026,
    businessName: '青井ウェブ事務所',
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
});