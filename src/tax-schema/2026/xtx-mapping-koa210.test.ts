import { describe, expect, test } from 'vitest';
import { D } from '../../lib/decimal';
import {
  BsExtraAccountOverflowError,
  mapKoa210RepeatedValues,
  mapKoa210Values,
} from './xtx-mapping-koa210';
import type { XtxContext } from './xtx';
import type { IncomeDeductionInput } from './income-deductions';
import type { BSRow, PLReport } from '../../domain/reports';
import type { FixedAsset } from '../../db/types';

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

describe('mapKoa210Values 売上原価（期首棚卸・仕入・期末棚卸）', () => {
  test('該当科目は AMF00120/00130/00150 に出力され、経費行に二重計上されない', () => {
    const out = mapKoa210Values(
      ctx({
        pl: {
          year: 2026,
          revenue: [],
          expense: [
            {
              accountCode: '5010',
              accountName: '期首商品棚卸高',
              category: 'expense' as const,
              amount: '100000',
              displayOrder: 10,
            },
            {
              accountCode: '5020',
              accountName: '仕入',
              category: 'expense' as const,
              amount: '2000000',
              displayOrder: 20,
            },
            {
              accountCode: '5030',
              accountName: '期末商品棚卸高',
              category: 'expense' as const,
              amount: '150000',
              displayOrder: 30,
            },
          ],
          totalRevenue: '0',
          totalExpense: '1950000',
          netIncome: '0',
          entryCount: 0,
        },
      }),
    );
    expect(out.AMF00120).toBe('100000'); // 期首商品（製品）棚卸高
    expect(out.AMF00130).toBe('2000000'); // 仕入金額（製品製造原価）
    expect(out.AMF00150).toBe('150000'); // 期末商品（製品）棚卸高
    // KOA110 と同様に差引原価（AMF00160）は算出・出力しない
    expect(out.AMF00160).toBeUndefined();
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

function bsRow(
  overrides: Partial<BSRow> & Pick<BSRow, 'accountName' | 'category' | 'balance'>,
): BSRow {
  return { accountCode: '0000', ...overrides };
}

describe('#294 貸借対照表：欄に無い科目を追加科目枠へ・所得金額転記・貸借一致', () => {
  test('issue の数値：減価償却累計額（間接法）は資産の追加科目枠へマイナスで入り、AMG00750 に所得金額が入り、両側が一致する', () => {
    // issue #294 の元入金 500,000・工具器具備品 1,000,000・減価償却累計額 -400,000 はそのまま採用。
    // 所得金額は issue 記載の 3,050,000 のままだと（事業主貸/借 抜きの）この最小構成では
    // 貸借が一致しないため、貸借一致の性質を検証できるよう 100,000 に変更している。
    const values = mapKoa210Values(
      ctx({
        bs: {
          year: 2026,
          asOf: '2026-12-31',
          assets: [
            bsRow({ accountName: '工具器具備品', category: 'asset', balance: '1000000' }),
            bsRow({ accountName: '減価償却累計額', category: 'asset', balance: '-400000' }),
          ],
          liabilities: [],
          equity: [bsRow({ accountName: '元入金', category: 'equity', balance: '500000' })],
          netIncome: '100000',
          totalAssets: '600000',
          totalLiabilitiesAndEquity: '600000',
          balanced: true,
        },
      }),
    );
    const repeated = mapKoa210RepeatedValues(
      ctx({
        bs: {
          year: 2026,
          asOf: '2026-12-31',
          assets: [
            bsRow({ accountName: '工具器具備品', category: 'asset', balance: '1000000' }),
            bsRow({ accountName: '減価償却累計額', category: 'asset', balance: '-400000' }),
          ],
          liabilities: [],
          equity: [bsRow({ accountName: '元入金', category: 'equity', balance: '500000' })],
          netIncome: '100000',
          totalAssets: '600000',
          totalLiabilitiesAndEquity: '600000',
          balanced: true,
        },
      }),
    );
    expect(values.AMG00400).toBe('1000000'); // 工具器具備品（期末）
    expect(values.AMG00740).toBe('500000'); // 元入金（期末）
    expect(values.AMG00750).toBe('100000'); // 青色申告特別控除前の所得金額
    const extraAssetRows = repeated.AMG00025!;
    expect(extraAssetRows).toHaveLength(1);
    expect(extraAssetRows[0]!.AMG00030).toBe('減価償却累計額');
    expect(extraAssetRows[0]!.AMG00420).toBe('-400000'); // 契約通り先頭マイナスを維持
    const assetSide = D(values.AMG00400!).plus(extraAssetRows[0]!.AMG00420!);
    const liabilityEquitySide = D(values.AMG00740!).plus(values.AMG00750!);
    expect(assetSide.toString()).toBe('600000');
    expect(liabilityEquitySide.toString()).toBe('600000');
    expect(assetSide.equals(liabilityEquitySide)).toBe(true);
  });

  test('利用者独自科目（様式に欄が無い）も追加科目枠に入り、消えない', () => {
    const repeated = mapKoa210RepeatedValues(
      ctx({
        bs: {
          year: 2026,
          asOf: '2026-12-31',
          assets: [bsRow({ accountName: '暗号資産', category: 'asset', balance: '50000' })],
          liabilities: [],
          equity: [],
          netIncome: '0',
          totalAssets: '50000',
          totalLiabilitiesAndEquity: '0',
          balanced: false,
        },
      }),
    );
    expect(repeated.AMG00025).toEqual([{ AMG00030: '暗号資産', AMG00420: '50000' }]);
  });

  test('資産の追加科目枠（maxOccurs 7）を超えると、超過科目名を含むエラーで例外を投げる', () => {
    const assets = Array.from({ length: 8 }, (_, i) =>
      bsRow({ accountName: `独自科目${i}`, category: 'asset' as const, balance: '1000' }),
    );
    expect(() =>
      mapKoa210RepeatedValues(
        ctx({
          bs: {
            year: 2026,
            asOf: '2026-12-31',
            assets,
            liabilities: [],
            equity: [],
            netIncome: '0',
            totalAssets: '8000',
            totalLiabilitiesAndEquity: '0',
            balanced: false,
          },
        }),
      ),
    ).toThrowError(/独自科目0.*独自科目7|独自科目7.*独自科目0/s);
  });

  test('負債・資本の追加科目枠（AMG00465＋AMG00475、計 14）を超えると例外を投げる', () => {
    const liabilities = Array.from({ length: 15 }, (_, i) =>
      bsRow({ accountName: `負債独自${i}`, category: 'liability' as const, balance: '1000' }),
    );
    expect(() =>
      mapKoa210RepeatedValues(
        ctx({
          bs: {
            year: 2026,
            asOf: '2026-12-31',
            assets: [],
            liabilities,
            equity: [],
            netIncome: '0',
            totalAssets: '0',
            totalLiabilitiesAndEquity: '15000',
            balanced: false,
          },
        }),
      ),
    ).toThrow(BsExtraAccountOverflowError);
  });

  test('全科目が様式の欄に一致する場合、追加科目の繰り返しブロックは出力しない（回帰防止）', () => {
    const repeated = mapKoa210RepeatedValues(
      ctx({
        bs: {
          year: 2026,
          asOf: '2026-12-31',
          assets: [
            bsRow({
              accountCode: '1110',
              accountName: '現金',
              category: 'asset',
              balance: '100000',
            }),
            bsRow({
              accountCode: '1510',
              accountName: '工具器具備品',
              category: 'asset',
              balance: '300000',
            }),
          ],
          liabilities: [
            bsRow({
              accountCode: '2110',
              accountName: '買掛金',
              category: 'liability',
              balance: '80000',
            }),
          ],
          equity: [
            bsRow({
              accountCode: '3110',
              accountName: '元入金',
              category: 'equity',
              balance: '320000',
            }),
          ],
          netIncome: '0',
          totalAssets: '400000',
          totalLiabilitiesAndEquity: '400000',
          balanced: true,
        },
      }),
    );
    expect(repeated).toEqual({});
  });
});

function asset(overrides: Partial<FixedAsset> & { id: string }): FixedAsset {
  return {
    name: '備品',
    acquisitionDate: '2024-06-01',
    acquisitionCost: '300000',
    usefulLifeYears: 4,
    depreciationMethod: 'straight-line',
    accountCode: '1510',
    ...overrides,
  };
}

describe('mapKoa210RepeatedValues 減価償却費の計算（第3頁 明細）', () => {
  test('資産 1 件：名称・取得価額・償却方法・耐用年数・償却費・専用割合・必要経費算入額・未償却残高', () => {
    const out = mapKoa210RepeatedValues(
      ctx({ fixedAssets: [asset({ id: 'a1', name: 'ノートPC' })] }),
    );
    const rows = out.AMF01600;
    expect(rows).toHaveLength(1);
    const row = rows![0]!;
    expect(row.AMF01610).toBe('ノートPC');
    expect(row.AMF01640).toBe('300000');
    expect(row.AMF01650).toBe('300000'); // 定額法の償却の基礎は常に取得価額
    expect(row.AMF01660).toBe('定額法');
    expect(row.AMF01670).toBe('4');
    expect(row.AMF01730).toBe('75000'); // 300000 × 0.250（定額法・全年）
    expect(row.AMF01750).toBe('75000'); // 償却費合計（割増なし＝普通償却費）
    expect(row.AMF01760).toBe('100'); // 事業専用割合
    expect(row.AMF01770).toBe('75000'); // 必要経費算入額 = 償却費 ×100%
    expect(row.AMF01780).toBe('106250'); // 未償却残高
    // gen:yymm 複合型は繰り返しブロックで表現できないため取得年月は出力しない
    expect(row.AMF01630).toBeUndefined();
  });

  test('定率法：AMF01650（償却の基礎になる金額）は取得価額ではなく前年末未償却残高', () => {
    // PC 100万円・耐用5年・定率法・2025-01 取得、2026年分を出力
    // 1年目(2025): 1,000,000 × 0.4 = 400,000 → 期末簿価 600,000
    // 2年目(2026): 償却の基礎 = 600,000、償却費 = 600,000 × 0.4 = 240,000
    const out = mapKoa210RepeatedValues(
      ctx({
        fixedAssets: [
          asset({
            id: 'a1',
            acquisitionDate: '2025-01-01',
            acquisitionCost: '1000000',
            usefulLifeYears: 5,
            depreciationMethod: 'declining-balance',
          }),
        ],
      }),
    );
    const row = out.AMF01600![0]!;
    expect(row.AMF01640).toBe('1000000');
    expect(row.AMF01650).toBe('600000');
    expect(row.AMF01730).toBe('240000');
  });

  test('専用割合は常に 100%（必要経費算入額 = 償却費）', () => {
    const out = mapKoa210RepeatedValues(ctx({ fixedAssets: [asset({ id: 'a1' })] }));
    const row = out.AMF01600![0]!;
    expect(row.AMF01760).toBe('100');
    expect(row.AMF01770).toBe(row.AMF01730);
  });

  test('複数件は取得日昇順に並ぶ', () => {
    const out = mapKoa210RepeatedValues(
      ctx({
        fixedAssets: [
          asset({ id: 'a1', name: '新しい', acquisitionDate: '2026-01-01' }),
          asset({ id: 'a2', name: '古い', acquisitionDate: '2024-06-01' }),
        ],
      }),
    );
    const rows = out.AMF01600!;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.AMF01610).toBe('古い');
    expect(rows[1]!.AMF01610).toBe('新しい');
  });

  test('8 件は 7 件（公式 xsd の maxOccurs）に切り捨てる', () => {
    const assets = Array.from({ length: 8 }, (_, i) =>
      asset({ id: `a${i}`, acquisitionDate: `2024-0${i + 1}-01`.slice(0, 10) }),
    );
    const out = mapKoa210RepeatedValues(ctx({ fixedAssets: assets }));
    expect(out.AMF01600).toHaveLength(7);
  });

  test('不動産所得用（incomeType: realEstate）の資産は除外する（KOA220 で出力）', () => {
    const out = mapKoa210RepeatedValues(
      ctx({
        fixedAssets: [
          asset({ id: 'a1', name: '事業備品' }),
          asset({ id: 'a2', name: '賃貸物件', incomeType: 'realEstate' }),
        ],
      }),
    );
    const rows = out.AMF01600!;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.AMF01610).toBe('事業備品');
  });

  test('資産が無ければ空（ブランチ自体を出力しない）', () => {
    expect(mapKoa210RepeatedValues(ctx({ fixedAssets: [] }))).toEqual({});
  });

  test('testReiwa7（year は令和7年ラベルだが帳簿データは令和8年）は dataYear で計算する', () => {
    const out = mapKoa210RepeatedValues(
      ctx({
        year: 2025,
        dataYear: 2026,
        fixedAssets: [asset({ id: 'a1', name: '新規備品', acquisitionDate: '2026-04-01' })],
      }),
    );
    const rows = out.AMF01600;
    expect(rows).toHaveLength(1);
    expect(rows![0]!.AMF01610).toBe('新規備品');
  });
});
