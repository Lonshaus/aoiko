import { describe, expect, test } from 'vitest';
import {
  koa110AdditionalExpenseOverflow,
  mapKoa110RepeatedValues,
  mapKoa110Values,
} from './xtx-mapping-koa110';
import { personalDeductionsToCtx, type XtxContext } from './xtx';
import type { FixedAsset } from '../../db/types';

function ctx(
  overrides: Partial<XtxContext['pl']> = {},
  fixedAssets: FixedAsset[] = [],
  personalDeductions?: XtxContext['personalDeductions'],
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
    ...(personalDeductions ? { personalDeductions } : {}),
  };
}
// 事業専従者1人分の personalDeductions（issue #307）。
function withFamilyEmployee(employee: {
  id: string;
  name: string;
  relation: 'spouse' | 'other';
  age: number;
  monthsWorked: number;
}): XtxContext['personalDeductions'] {
  return personalDeductionsToCtx({
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
    familyEmployees: [employee],
  });
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
          // 期末棚卸の標準仕訳は貸方のため buildPL の出力はマイナスになる
          {
            accountCode: '5030',
            accountName: '期末商品棚卸高',
            category: 'expense',
            amount: '-5000',
            displayOrder: 30,
          },
        ],
      }),
    );
    expect(out.AIG00080).toBe('10000');
    expect(out.AIG00090).toBe('200000');
    // 様式の期末棚卸欄は売上原価から差し引かれる欄なので符号を戻して出力する
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
            accountName: '貸倒引当金繰入額（一括評価）',
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
            accountName: '貸倒引当金繰入額（一括評価）',
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

  test('事業専従者控除（AIG00380）・控除後所得（AIG00400）を出力する（issue #307）', () => {
    const personalDeductions = withFamilyEmployee({
      id: 'f1',
      name: '配偶者花子',
      relation: 'spouse',
      age: 40,
      monthsWorked: 12,
    });
    const out = mapKoa110Values(
      ctx({ totalRevenue: '5000000', netIncome: '4000000' }, [], personalDeductions),
    );
    // 専従者控除前所得金額400万→配偶者の定額86万 と 400万÷2=200万 のいずれか低い方＝86万
    expect(out.AIG00380).toBe('860000');
    expect(out.AIG00400).toBe('3140000');
  });

  test('事業専従者がいなければ専従者控除は0・控除後所得＝控除前所得と同額', () => {
    const out = mapKoa110Values(ctx({ totalRevenue: '5000000', netIncome: '4000000' }));
    expect(out.AIG00380).toBe('0');
    expect(out.AIG00400).toBe('4000000');
  });

  test('貸倒引当金繰戻額（52条3項）は経費のマイナスではなく③その他の収入へ計上する（issue#379）', () => {
    const out = mapKoa110Values(
      ctx({
        totalRevenue: '5400000',
        revenue: [
          {
            accountCode: '4110',
            accountName: '売上高',
            category: 'revenue',
            amount: '5000000',
            displayOrder: 110,
          },
          {
            accountCode: '4120',
            accountName: '貸倒引当金繰戻額',
            category: 'revenue',
            amount: '400000',
            displayOrder: 120,
          },
        ],
      }),
    );
    expect(out.AIG00030).toBe('5000000');
    expect(out.AIG00050).toBe('400000');
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
    expect(row.AIM00180).toBe('100'); // 事業専用割合
    expect(row.AIM00190).toBe('75000');
    expect(row.AIM00200).toBe('225000');
  });

  test('専用割合は常に 100%（必要経費算入額 = 償却費）', () => {
    const out = mapKoa110RepeatedValues(ctx({}, [asset()]));
    const row = out.AIM00010![0]!;
    expect(row.AIM00180).toBe('100');
    expect(row.AIM00190).toBe(row.AIM00170);
  });

  test('資産名は16文字を超えたら切り詰める', () => {
    const longName = 'あ'.repeat(20);
    const out = mapKoa110RepeatedValues(ctx({}, [asset({ name: longName })]));
    expect(out.AIM00010![0]!.AIM00020).toBe('あ'.repeat(16));
  });

  // 賃貸物件は収支内訳書(不動産所得用) KOA130 側で出力される。両方に出すと
  // 明細の合計が本表の減価償却費と合わなくなる。
  test('不動産所得の資産は明細に含めない（KOA130 側で出力する）', () => {
    const out = mapKoa110RepeatedValues(
      ctx({}, [
        asset({ name: '事業用PC' }),
        asset({ name: '賃貸アパート', incomeType: 'realEstate' }),
      ]),
    );
    expect(out.AIM00010).toHaveLength(1);
    expect(out.AIM00010![0]!.AIM00020).toBe('事業用PC');
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

  test('定率法：AIM00070（償却の基礎になる金額）は取得価額ではなく前年末未償却残高', () => {
    // issue#302 の例：PC 100万円・耐用5年・定率法・2025-01 取得、2026年分を出力
    // 1年目(2025): 1,000,000 × 0.4 = 400,000 → 期末簿価 600,000
    // 2年目(2026): 償却の基礎 = 600,000、償却費 = 600,000 × 0.4 = 240,000
    const out = mapKoa110RepeatedValues(
      ctx({}, [
        asset({
          acquisitionDate: '2025-01-01',
          acquisitionCost: '1000000',
          usefulLifeYears: 5,
          depreciationMethod: 'declining-balance',
        }),
      ]),
    );
    const row = out.AIM00010![0]!;
    expect(row.AIM00060).toBe('1000000');
    expect(row.AIM00070).toBe('600000');
    expect(row.AIM00150).toBe('240000');
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

describe('mapKoa110RepeatedValues（AIJ00010 事業専従者明細、issue #307）', () => {
  test('事業専従者1人分の明細行を出力する', () => {
    const personalDeductions = withFamilyEmployee({
      id: 'f1',
      name: '配偶者花子',
      relation: 'spouse',
      age: 40,
      monthsWorked: 12,
    });
    const out = mapKoa110RepeatedValues(
      ctx({ totalRevenue: '5000000', netIncome: '4000000' }, [], personalDeductions),
    );
    expect(out.AIJ00010).toHaveLength(1);
    const row = out.AIJ00010![0]!;
    expect(row.AIJ00020).toBe('配偶者花子');
    expect(row.AIJ00030).toBe('40');
    expect(row.AIJ00040).toBe('配偶者');
    expect(row.AIJ00050).toBe('12');
  });

  test('事業専従者がいなければ AIJ00010 自体を出力しない', () => {
    const out = mapKoa110RepeatedValues(ctx({ totalRevenue: '5000000', netIncome: '4000000' }));
    expect(out.AIJ00010).toBeUndefined();
  });

  test('要件を満たさない専従者（14歳）は明細に出力しない', () => {
    const personalDeductions = withFamilyEmployee({
      id: 'f1',
      name: '子太郎',
      relation: 'other',
      age: 14,
      monthsWorked: 12,
    });
    const out = mapKoa110RepeatedValues(
      ctx({ totalRevenue: '5000000', netIncome: '4000000' }, [], personalDeductions),
    );
    expect(out.AIJ00010).toBeUndefined();
  });
});

describe('mapKoa110RepeatedValues（AIG00325 追加科目、issue#379）', () => {
  function expenseRow(accountName: string, amount: string, displayOrder = 900) {
    return { accountCode: '9999', accountName, category: 'expense' as const, amount, displayOrder };
  }

  test('固定欄に対応しない経費科目は追加科目欄へ回す', () => {
    const out = mapKoa110RepeatedValues(ctx({ expense: [expenseRow('固定資産除却損', '50000')] }));
    expect(out.AIG00325).toHaveLength(1);
    expect(out.AIG00325![0]!.AIG00330).toBe('50000');
  });

  test('科目名はちょうど10文字なら切り詰めない', () => {
    const name10 = 'あ'.repeat(10);
    const out = mapKoa110RepeatedValues(ctx({ expense: [expenseRow(name10, '1000')] }));
    expect(out.AIG00325![0]!.AIG00010).toBe(name10);
  });

  test('科目名が11文字なら10文字に切り詰める', () => {
    const name11 = 'あ'.repeat(11);
    const out = mapKoa110RepeatedValues(ctx({ expense: [expenseRow(name11, '1000')] }));
    expect(out.AIG00325![0]!.AIG00010).toBe('あ'.repeat(10));
  });

  test('末尾の分類（個別評価）は科目名欄に不要なため取り除く（貸倒引当金繰入額＝8文字で収まる）', () => {
    const out = mapKoa110RepeatedValues(
      ctx({ expense: [expenseRow('貸倒引当金繰入額（個別評価）', '400000')] }),
    );
    expect(out.AIG00325![0]!.AIG00010).toBe('貸倒引当金繰入額');
  });

  test('分類を取り除いても10文字を超える場合はバックストップとして切り詰める', () => {
    const name = `${'あ'.repeat(11)}（区分）`;
    const out = mapKoa110RepeatedValues(ctx({ expense: [expenseRow(name, '1000')] }));
    expect(out.AIG00325![0]!.AIG00010).toBe('あ'.repeat(10));
  });

  test('専従者給与・貸倒引当金繰入額（一括評価）は追加科目にも転記しない（issue#378の除外を共有）', () => {
    const out = mapKoa110RepeatedValues(
      ctx({
        expense: [
          expenseRow('専従者給与', '860000'),
          expenseRow('貸倒引当金繰入額（一括評価）', '30000'),
        ],
      }),
    );
    expect(out.AIG00325).toBeUndefined();
  });

  test('6件目以降は追加科目欄（上限5）に収まらず overflow として報告する', () => {
    const rows = Array.from({ length: 6 }, (_, i) => expenseRow(`雑科目${i}`, String(1000 + i)));
    const out = mapKoa110RepeatedValues(ctx({ expense: rows }));
    expect(out.AIG00325).toHaveLength(5);
    const overflow = koa110AdditionalExpenseOverflow(ctx({ expense: rows }));
    expect(overflow).toHaveLength(1);
    expect(overflow[0]!.accountName).toBe('雑科目5');
  });
});
