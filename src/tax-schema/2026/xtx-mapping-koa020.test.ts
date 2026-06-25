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
  test('営業等収入金額に売上(収入)合計が整数円で入る', () => {
    const out = mapKoa020LeafValues(
      ctx({
        pl: {
          year: 2026,
          revenue: [],
          expense: [],
          totalRevenue: '5,000,000.40',
          totalExpense: '0',
          netIncome: '0',
          entryCount: 0,
        },
      })
    );
    const values = Object.values(out);
    expect(values).toEqual(['5000000']);
  });

  test('事業所得・所得控除・税額は載せない（青色控除/本人情報を収集しないため）', () => {
    const out = mapKoa020LeafValues(
      ctx({
        pl: {
          year: 2026,
          revenue: [],
          expense: [],
          totalRevenue: '3000000',
          totalExpense: '1000000',
          netIncome: '2000000',
          entryCount: 1,
        },
      })
    );
    // 営業等収入の 1 件のみ。所得金額(控除後)・控除・税額は出力しない
    expect(Object.keys(out)).toHaveLength(1);
  });
});