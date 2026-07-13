import { describe, expect, test } from 'vitest';
import { mapKoa110RepeatedValues, mapKoa110Values } from './xtx-mapping-koa110';
import type { XtxContext } from './xtx';
import type { FixedAsset } from '../../db/types';

function ctx(
  overrides: Partial<XtxContext['pl']> = {},
  fixedAssets: FixedAsset[] = [],
): XtxContext {
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
    fixedAssets,
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
      }),
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
      }),
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
      }),
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
      }),
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
      }),
    );
    // 専従者給与・貸倒引当金繰入額の分を所得へ加算し直す：3990000+860000+30000=4880000
    expect(out.AIG00370).toBe('4880000');
  });
});

function asset(overrides: Partial<FixedAsset> = {}): FixedAsset {
  return {
    id: 'a1',
    name: 'テストPC',
    acquisitionDate: '2026-01-01',
    acquisitionCost: '300000',
    usefulLifeYears: 4,
    depreciationMethod: 'straight-line',
    accountCode: '1510',
    ...overrides,
  };
}

describe('mapKoa110RepeatedValues（第2頁 減価償却資産の明細）', () => {
  test('資産1件分の明細行を出力する', () => {
    const out = mapKoa110RepeatedValues(ctx({}, [asset()]));
    expect(out.AIM00010).toHaveLength(1);
    const row = out.AIM00010![0]!;
    expect(row.AIM00020).toBe('テストPC');
    expect(row.AIM00060).toBe('300000');
    expect(row.AIM00070).toBe('300000');
    expect(row.AIM00080).toBe('定額法');
    expect(row.AIM00090).toBe('4');
    // 2026年分定額法：300000 × 0.250 = 75000
    expect(row.AIM00150).toBe('75000');
    expect(row.AIM00170).toBe('75000');
    expect(row.AIM00190).toBe('75000');
    expect(row.AIM00200).toBe('225000');
  });

  test('資産名は16文字を超えたら切り詰める', () => {
    const longName = 'あ'.repeat(20);
    const out = mapKoa110RepeatedValues(ctx({}, [asset({ name: longName })]));
    expect(out.AIM00010![0]!.AIM00020).toBe('あ'.repeat(16));
  });

  test('当年の償却額が0の資産（まだ取得前）は行を作らない', () => {
    // ctx() の year は 2026 固定。取得日を翌年にして「まだ取得前」を再現
    const out = mapKoa110RepeatedValues(ctx({}, [asset({ acquisitionDate: '2027-01-01' })]));
    expect(out.AIM00010 ?? []).toHaveLength(0);
  });

  test('耐用年数が範囲外（1年）なら AIM00090 を出力しない', () => {
    const out = mapKoa110RepeatedValues(ctx({}, [asset({ usefulLifeYears: 1 })]));
    expect(out.AIM00010![0]!.AIM00090).toBeUndefined();
  });

  test('7件以上あれば取得日昇順で先頭6件のみ出力する', () => {
    const assets = Array.from({ length: 8 }, (_, i) =>
      asset({ id: `a${i}`, name: `資産${i}`, acquisitionDate: `2026-01-0${i + 1}` }),
    );
    const out = mapKoa110RepeatedValues(ctx({}, assets));
    expect(out.AIM00010).toHaveLength(6);
    expect(out.AIM00010!.map((r) => r.AIM00020)).toEqual([
      '資産0',
      '資産1',
      '資産2',
      '資産3',
      '資産4',
      '資産5',
    ]);
  });

  test('償却方法ごとに正しいラベルを出力する', () => {
    const out = mapKoa110RepeatedValues(
      ctx({}, [
        asset({
          id: 'a',
          acquisitionCost: '150000',
          usefulLifeYears: 4,
          depreciationMethod: 'lump-sum',
        }),
      ]),
    );
    expect(out.AIM00010![0]!.AIM00080).toBe('一括償却');
  });

  test('資産が無ければ AIM00010 自体を出力しない', () => {
    const out = mapKoa110RepeatedValues(ctx({}, []));
    expect(out.AIM00010).toBeUndefined();
  });

  test('当年に除却した資産は摘要欄に「除却」を出力する', () => {
    const out = mapKoa110RepeatedValues(
      ctx({}, [asset({ disposedDate: '2026-06-30', disposalType: 'scrap' })]),
    );
    expect(out.AIM00010![0]!.AIM00210).toBe('除却');
  });

  test('当年に売却した資産は摘要欄に「売却」を出力する', () => {
    const out = mapKoa110RepeatedValues(
      ctx({}, [asset({ disposedDate: '2026-06-30', disposalType: 'sale', salePrice: '100000' })]),
    );
    expect(out.AIM00010![0]!.AIM00210).toBe('売却');
  });

  test('除却日が翌年以降なら当年の摘要欄には出力しない', () => {
    const out = mapKoa110RepeatedValues(
      ctx({}, [asset({ disposedDate: '2027-06-30', disposalType: 'scrap' })]),
    );
    expect(out.AIM00010![0]!.AIM00210).toBeUndefined();
  });

  test('testReiwa7（year は令和7年ラベルだが帳簿データは令和8年）は dataYear で計算する', () => {
    const out = mapKoa110RepeatedValues({
      ...ctx({}, [asset({ acquisitionDate: '2026-04-01' })]),
      year: 2025,
      dataYear: 2026,
    });
    expect(out.AIM00010).toHaveLength(1);
  });
});
