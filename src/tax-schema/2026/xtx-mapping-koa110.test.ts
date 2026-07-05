import { describe, expect, test } from 'vitest';
import { mapKoa110Values } from './xtx-mapping-koa110';
import type { XtxContext } from './xtx';

function ctx(overrides: Partial<XtxContext['pl']> = {}): XtxContext {
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
      ...overrides,
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
  };
}

describe('mapKoa110Values（収支内訳書 一般用）', () => {
  test('売上（収入）金額・専従者控除前の所得金額を出力（経費が無ければ所得＝収入）', () => {
    const out = mapKoa110Values(ctx({ totalRevenue: '5000000', netIncome: '5000000' }));
    expect(out.AIG00030).toBe('5000000');
    expect(out.AIG00370).toBe('5000000');
  });

  test('専従者控除前の所得金額＝netIncome をそのまま反映（除外科目が無い場合）', () => {
    const out = mapKoa110Values(
      ctx({
        totalRevenue: '5000000',
        netIncome: '4880000',
        expense: [
          {
            accountCode: '5130',
            accountName: '水道光熱費',
            category: 'expense',
            amount: '120000',
            displayOrder: 130,
          },
        ],
      })
    );
    expect(out.AIG00370).toBe('4880000');
  });

  test('同名科目（水道光熱費）はそのまま同名欄へ', () => {
    const out = mapKoa110Values(
      ctx({
        expense: [
          {
            accountCode: '5130',
            accountName: '水道光熱費',
            category: 'expense',
            amount: '120000',
            displayOrder: 130,
          },
        ],
      })
    );
    expect(out.AIG00240).toBe('120000');
  });

  test('棚卸・仕入は別名（製品）付きの欄へ変換', () => {
    const out = mapKoa110Values(
      ctx({
        expense: [
          {
            accountCode: '5010',
            accountName: '期首商品棚卸高',
            category: 'expense',
            amount: '10000',
            displayOrder: 10,
          },
          {
            accountCode: '5020',
            accountName: '仕入',
            category: 'expense',
            amount: '200000',
            displayOrder: 20,
          },
          {
            accountCode: '5030',
            accountName: '期末商品棚卸高',
            category: 'expense',
            amount: '5000',
            displayOrder: 30,
          },
        ],
      })
    );
    expect(out.AIG00080).toBe('10000');
    expect(out.AIG00090).toBe('200000');
    expect(out.AIG00110).toBe('5000');
  });

  test('専従者給与・貸倒引当金繰入額は収支内訳書に対応欄が無いため出力しない', () => {
    const out = mapKoa110Values(
      ctx({
        expense: [
          {
            accountCode: '5250',
            accountName: '専従者給与',
            category: 'expense',
            amount: '860000',
            displayOrder: 250,
          },
          {
            accountCode: '5260',
            accountName: '貸倒引当金繰入額',
            category: 'expense',
            amount: '30000',
            displayOrder: 260,
          },
        ],
      })
    );
    expect(Object.values(out)).not.toContain('860000');
    expect(Object.values(out)).not.toContain('30000');
  });

  test('専従者給与・貸倒引当金繰入額は所得金額の計算からも除外（差し引かない）', () => {
    const out = mapKoa110Values(
      ctx({
        totalRevenue: '5000000',
        // netIncome は帳簿上の全経費（水道光熱費+専従者給与+貸倒引当金繰入額）控除後
        netIncome: '3990000',
        expense: [
          {
            accountCode: '5130',
            accountName: '水道光熱費',
            category: 'expense',
            amount: '120000',
            displayOrder: 130,
          },
          {
            accountCode: '5250',
            accountName: '専従者給与',
            category: 'expense',
            amount: '860000',
            displayOrder: 250,
          },
          {
            accountCode: '5260',
            accountName: '貸倒引当金繰入額',
            category: 'expense',
            amount: '30000',
            displayOrder: 260,
          },
        ],
      })
    );
    // 専従者給与・貸倒引当金繰入額の分を所得へ加算し直す：3990000+860000+30000=4880000
    expect(out.AIG00370).toBe('4880000');
  });
});