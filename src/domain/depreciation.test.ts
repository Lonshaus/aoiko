import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { newId } from '../lib/id';
import {
  computeDepreciation,
  depreciationLimit,
  generateYearEndDepreciation,
  lumpSumPoolShares,
  oldDecliningBalanceRate,
  oldMethodResidualValue,
  smallAssetSpecialStatuses,
  straightLineRate,
} from './depreciation';
import { D } from '../lib/decimal';
import { reverseEntry } from './reverse';
import type { FixedAsset } from '../db/types';

function asset(overrides: Partial<FixedAsset> = {}): FixedAsset {
  return {
    id: newId(),
    name: 'テスト PC',
    acquisitionDate: '2026-01-01',
    acquisitionCost: '300000',
    usefulLifeYears: 4,
    depreciationMethod: 'straight-line',
    accountCode: '1510',
    ...overrides,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('straightLineRate（定額法償却率＝1/N の小数第3位未満切上げ）', () => {
  test('割り切れる年数はそのまま', () => {
    expect(straightLineRate(2).toString()).toBe('0.5');
    expect(straightLineRate(4).toString()).toBe('0.25');
    expect(straightLineRate(5).toString()).toBe('0.2');
    expect(straightLineRate(8).toString()).toBe('0.125');
    expect(straightLineRate(10).toString()).toBe('0.1');
  });

  test('割り切れない年数は切り上げ（国税庁償却率表に一致）', () => {
    expect(straightLineRate(3).toString()).toBe('0.334');
    expect(straightLineRate(6).toString()).toBe('0.167');
    expect(straightLineRate(7).toString()).toBe('0.143');
    expect(straightLineRate(9).toString()).toBe('0.112');
  });
});

describe('computeDepreciation - 定額法', () => {
  test('全期間取得：年額 = 取得価額 × 定額法償却率', () => {
    // 300,000 円、4 年、1 月取得 → 300000 × 0.25 = 75,000
    const r = computeDepreciation(asset({ acquisitionDate: '2026-01-01' }), 2026);
    expect(r.amount).toBe('75000');
  });

  test('割り切れない耐用年数は法定償却率を使う（単純 1/N ではない）', () => {
    // 3 年資産 300,000 円：率 0.334 → 年額 300000 × 0.334 = 100,200（単純 1/3=100,000 ではない）
    const r = computeDepreciation(
      asset({ acquisitionDate: '2026-01-01', acquisitionCost: '300000', usefulLifeYears: 3 }),
      2026,
    );
    expect(r.amount).toBe('100200');
  });

  test('3 年資産は最終年で簿価 1 円に収束', () => {
    const a = asset({
      acquisitionDate: '2026-01-01',
      acquisitionCost: '300000',
      usefulLifeYears: 3,
    });
    // 100,200 / 100,200 → 累計 200,400、残 99,599
    const r2028 = computeDepreciation(a, 2028);
    expect(r2028.amount).toBe('99599');
    expect(r2028.bookValueEnd).toBe('1');
    expect(r2028.fullyDepreciated).toBe(true);
  });

  test('取得月按分：4 月取得は初年度 9 ヶ月分', () => {
    // 300,000 円、4 年、4 月取得 → 初年度 (75000/12)*9 = 56,250
    const r = computeDepreciation(asset({ acquisitionDate: '2026-04-15' }), 2026);
    expect(r.amount).toBe('56250');
  });

  test('翌年は満年度償却', () => {
    const r = computeDepreciation(asset({ acquisitionDate: '2026-04-15' }), 2027);
    expect(r.amount).toBe('75000');
  });

  test('取得前の年は償却額 0', () => {
    const r = computeDepreciation(asset({ acquisitionDate: '2026-04-15' }), 2025);
    expect(r.amount).toBe('0');
    expect(r.bookValueEnd).toBe('300000');
    expect(r.depreciationBase).toBe('300000');
  });

  test('残存簿価 1 円残し：最終年度は端数を上限', () => {
    // 2026/01 取得、4 年。標準年額 75,000、償却可能残 = 299,999。
    // 年度ごと：75000 / 75000 / 75000 → 累計 225,000、残 74,999
    // 4 年目：min(75000, 74999) = 74999、累計 299999、簿価 1
    const a = asset({
      acquisitionDate: '2026-01-01',
      acquisitionCost: '300000',
      usefulLifeYears: 4,
    });
    const r2029 = computeDepreciation(a, 2029);
    expect(r2029.amount).toBe('74999');
    expect(r2029.accumulatedEnd).toBe('299999');
    expect(r2029.bookValueEnd).toBe('1');
    expect(r2029.fullyDepreciated).toBe(true);
  });

  test('完全償却後の年は償却額 0、簿価は 1 円維持', () => {
    const a = asset({
      acquisitionDate: '2026-01-01',
      acquisitionCost: '300000',
      usefulLifeYears: 4,
    });
    const r = computeDepreciation(a, 2030);
    expect(r.amount).toBe('0');
    expect(r.bookValueEnd).toBe('1');
    expect(r.fullyDepreciated).toBe(true);
  });

  test('除却後の年は償却なし', () => {
    const a = asset({
      acquisitionDate: '2026-01-01',
      disposedDate: '2027-06-30',
    });
    const r = computeDepreciation(a, 2028);
    expect(r.amount).toBe('0');
    // 除却年（2027）時点の償却の基礎（定額法＝取得価額）をそのまま引き継ぐ
    expect(r.depreciationBase).toBe('300000');
  });

  test('処分年度は処分月まで月割（定額法）', () => {
    // 300,000 円・4 年・2026/01 取得、2027/06 処分。
    // 2026: 75,000（満年度）。2027: 75000 × 6/12 = 37,500（1〜6月）
    const a = asset({
      acquisitionDate: '2026-01-01',
      acquisitionCost: '300000',
      usefulLifeYears: 4,
      disposedDate: '2027-06-30',
    });
    const r = computeDepreciation(a, 2027);
    expect(r.amount).toBe('37500');
  });
});

describe('computeDepreciation - 定率法（200%）', () => {
  test('耐用年数 5 年・1月取得・初年度', () => {
    const a = asset({
      acquisitionDate: '2026-01-01',
      acquisitionCost: '1000000',
      usefulLifeYears: 5,
      depreciationMethod: 'declining-balance',
    });
    const r = computeDepreciation(a, 2026);
    // 1,000,000 × 0.400 × 12/12 = 400,000
    expect(r.amount).toBe('400000');
    expect(r.bookValueEnd).toBe('600000');
    // 取得年の償却の基礎になる金額は取得価額そのもの
    expect(r.depreciationBase).toBe('1000000');
  });

  test('耐用年数 5 年・1月取得・2年目', () => {
    const a = asset({
      acquisitionDate: '2026-01-01',
      acquisitionCost: '1000000',
      usefulLifeYears: 5,
      depreciationMethod: 'declining-balance',
    });
    const r = computeDepreciation(a, 2027);
    // 期首簿価 600,000 × 0.400 = 240,000
    expect(r.amount).toBe('240000');
    expect(r.bookValueEnd).toBe('360000');
    // 前年以前取得：償却の基礎は前年末未償却残高（600,000）
    expect(r.depreciationBase).toBe('600000');
  });

  test('耐用年数 5 年・1月取得・3年目', () => {
    const a = asset({
      acquisitionDate: '2026-01-01',
      acquisitionCost: '1000000',
      usefulLifeYears: 5,
      depreciationMethod: 'declining-balance',
    });
    const r = computeDepreciation(a, 2028);
    // 期首簿価 360,000 × 0.400 = 144,000
    expect(r.amount).toBe('144000');
    expect(r.depreciationBase).toBe('360000');
  });

  test('耐用年数 5 年・1月取得・最終年で残存簿価 1 円に収束', () => {
    const a = asset({
      acquisitionDate: '2026-01-01',
      acquisitionCost: '1000000',
      usefulLifeYears: 5,
      depreciationMethod: 'declining-balance',
    });
    const r = computeDepreciation(a, 2030);
    expect(r.bookValueEnd).toBe('1');
    expect(r.fullyDepreciated).toBe(true);
  });

  test('耐用年数 5 年・7月取得は月按分', () => {
    const a = asset({
      acquisitionDate: '2026-07-01',
      acquisitionCost: '1000000',
      usefulLifeYears: 5,
      depreciationMethod: 'declining-balance',
    });
    const r = computeDepreciation(a, 2026);
    // 1,000,000 × 0.400 × 6/12 = 200,000
    expect(r.amount).toBe('200000');
  });

  test('未登録の耐用年数で例外を投げる', () => {
    expect(() =>
      computeDepreciation(
        asset({ usefulLifeYears: 25, depreciationMethod: 'declining-balance' }),
        2026,
      ),
    ).toThrow(/償却率テーブル/);
  });

  test('改定償却率モード切替後は均等償却', () => {
    // 5 年・1,000,000 円のケース
    // 1年目: 1,000,000 × 0.4 = 400,000  → 残 600,000
    // 2年目: 600,000 × 0.4 = 240,000   → 残 360,000
    // 3年目: 360,000 × 0.4 = 144,000   → 残 216,000
    // 4年目: 216,000 × 0.4 = 86,400 < 保証額 1,000,000 × 0.108 = 108,000
    //        → 改定取得価額 216,000 × 0.5 = 108,000
    // 5年目: 108,000（残 1 円調整）
    const a = asset({
      acquisitionDate: '2026-01-01',
      acquisitionCost: '1000000',
      usefulLifeYears: 5,
      depreciationMethod: 'declining-balance',
    });
    const r4 = computeDepreciation(a, 2029);
    expect(r4.amount).toBe('108000');
  });

  test('改定償却率切替年以後は改定取得価額（期首未償却残高）で償却の基礎が凍結される', () => {
    // 上のケースの続き：4年目（2029）に改定モードへ切替、改定取得価額 = 216,000 で以後固定。
    // 5年目（2030）は残存簿価調整で償却費は 107,999 になるが、償却の基礎は 216,000 のまま。
    // 6年目（2031）は完全償却後で償却費 0 だが、償却の基礎は依然 216,000。
    const a = asset({
      acquisitionDate: '2026-01-01',
      acquisitionCost: '1000000',
      usefulLifeYears: 5,
      depreciationMethod: 'declining-balance',
    });
    const switchYear = computeDepreciation(a, 2029);
    const nextYear = computeDepreciation(a, 2030);
    const yearAfter = computeDepreciation(a, 2031);
    expect(switchYear.depreciationBase).toBe('216000');
    expect(nextYear.depreciationBase).toBe('216000');
    expect(yearAfter.depreciationBase).toBe('216000');
    expect(nextYear.amount).toBe('107999');
    expect(nextYear.fullyDepreciated).toBe(true);
    expect(yearAfter.amount).toBe('0');
  });
});

describe('generateYearEndDepreciation', () => {
  test('全資産分の仕訳を作成し、件数を返す', async () => {
    await db.fixedAssets.bulkAdd([
      asset({
        id: 'a1',
        name: 'PC',
        acquisitionCost: '300000',
        usefulLifeYears: 4,
        acquisitionDate: '2026-01-01',
      }),
      asset({
        id: 'a2',
        name: 'デスク',
        acquisitionCost: '60000',
        usefulLifeYears: 6,
        acquisitionDate: '2026-01-01',
      }),
    ]);

    const r = await generateYearEndDepreciation(2026);
    expect(r.created).toBe(2);

    const entries = await db.journalEntries.toArray();
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.date === '2026-12-31')).toBe(true);

    const lines = await db.journalLines.toArray();
    expect(lines).toHaveLength(4);
    const expense = lines.filter((l) => l.accountCode === '5210');
    const accumulated = lines.filter((l) => l.accountCode === '1520');
    expect(expense).toHaveLength(2);
    expect(accumulated).toHaveLength(2);
    expect(expense.every((l) => l.side === 'debit')).toBe(true);
    expect(accumulated.every((l) => l.side === 'credit')).toBe(true);
  });

  test('償却額 0 の資産はスキップ', async () => {
    await db.fixedAssets.add(
      asset({ acquisitionDate: '2027-01-01' }), // 2026 年度は取得前
    );
    const r = await generateYearEndDepreciation(2026);
    expect(r.created).toBe(0);
  });

  test('再実行：既存仕訳は skipped でカウント', async () => {
    await db.fixedAssets.add(asset({ id: 'a1', name: 'PC', acquisitionDate: '2026-01-01' }));
    await generateYearEndDepreciation(2026);
    const r = await generateYearEndDepreciation(2026);
    expect(r.created).toBe(0);
    expect(r.skipped).toBe(1);
  });

  test('訂正（reverseEntry）後は再生成できる（reversed は重複判定外）', async () => {
    await db.fixedAssets.add(asset({ id: 'a1', name: 'PC', acquisitionDate: '2026-01-01' }));
    await generateYearEndDepreciation(2026);
    // 生成した償却仕訳を訂正する
    const dep = await db.journalEntries
      .filter((e) => e.description.includes('#a1') && e.originalEntryId === undefined)
      .first();
    await reverseEntry(dep!.id);

    const r = await generateYearEndDepreciation(2026);
    expect(r.created).toBe(1);
    expect(r.skipped).toBe(0);
  });
});

describe('computeDepreciation - 少額特例', () => {
  test('取得年度に全額損金、簿価 0', () => {
    const a = asset({
      acquisitionDate: '2026-04-01',
      acquisitionCost: '350000',
      depreciationMethod: 'small-asset-special',
    });
    const r = computeDepreciation(a, 2026);
    expect(r.amount).toBe('350000');
    expect(r.accumulatedEnd).toBe('350000');
    expect(r.bookValueEnd).toBe('0');
    expect(r.fullyDepreciated).toBe(true);
  });

  test('取得年度以降は償却 0', () => {
    const a = asset({
      acquisitionDate: '2026-04-01',
      acquisitionCost: '350000',
      depreciationMethod: 'small-asset-special',
    });
    const r = computeDepreciation(a, 2027);
    expect(r.amount).toBe('0');
    expect(r.bookValueEnd).toBe('0');
  });

  test('除却後の年も簿価 0（少額特例は残存簿価 1 円を残さない）', () => {
    // 取得年度に全額損金算入済みなので、除却後の簿価は 1 円ではなく 0
    const a = asset({
      acquisitionDate: '2026-04-01',
      acquisitionCost: '350000',
      depreciationMethod: 'small-asset-special',
      disposedDate: '2027-08-31',
    });
    const r = computeDepreciation(a, 2028);
    expect(r.amount).toBe('0');
    expect(r.bookValueEnd).toBe('0');
  });

  test('取得月按分なし（即時全額）', () => {
    // 通常の定額/定率法と違って、月按分なしで全額損金
    const a = asset({
      acquisitionDate: '2026-12-15',
      acquisitionCost: '399000',
      depreciationMethod: 'small-asset-special',
    });
    const r = computeDepreciation(a, 2026);
    expect(r.amount).toBe('399000');
  });
});

describe('computeDepreciation - 一括償却資産', () => {
  test('3年均等償却・取得月按分なし', () => {
    const a = asset({
      acquisitionDate: '2026-12-15',
      acquisitionCost: '180000',
      depreciationMethod: 'lump-sum',
    });
    // 180000/3=60000 ちょうど。12月取得でも月按分されず満額
    expect(computeDepreciation(a, 2026).amount).toBe('60000');
    expect(computeDepreciation(a, 2027).amount).toBe('60000');
    const r2028 = computeDepreciation(a, 2028);
    expect(r2028.amount).toBe('60000');
    expect(r2028.bookValueEnd).toBe('0');
    expect(r2028.fullyDepreciated).toBe(true);
  });

  test('3で割り切れない金額は最終年で端数調整', () => {
    const a = asset({
      acquisitionDate: '2026-01-01',
      acquisitionCost: '100000',
      depreciationMethod: 'lump-sum',
    });
    expect(computeDepreciation(a, 2026).amount).toBe('33333');
    expect(computeDepreciation(a, 2027).amount).toBe('33333');
    const r2028 = computeDepreciation(a, 2028);
    expect(r2028.amount).toBe('33334');
    expect(r2028.accumulatedEnd).toBe('100000');
    expect(r2028.bookValueEnd).toBe('0');
  });

  test('3年経過後は償却0・簿価0', () => {
    const a = asset({
      acquisitionDate: '2026-01-01',
      acquisitionCost: '180000',
      depreciationMethod: 'lump-sum',
    });
    const r = computeDepreciation(a, 2029);
    expect(r.amount).toBe('0');
    expect(r.bookValueEnd).toBe('0');
    expect(r.fullyDepreciated).toBe(true);
  });

  test('除却後も3年均等償却を継続する（一時損金算入しない）', () => {
    const a = asset({
      acquisitionDate: '2026-01-01',
      acquisitionCost: '180000',
      depreciationMethod: 'lump-sum',
      disposedDate: '2027-06-30',
    });
    // 除却翌年（2028）も通常どおり60000償却が続く
    const r = computeDepreciation(a, 2028);
    expect(r.amount).toBe('60000');
    expect(r.bookValueEnd).toBe('0');
    expect(r.fullyDepreciated).toBe(true);
  });
});

describe('generateYearEndDepreciation - 少額特例', () => {
  test('適用要件外（取得価額が閾値以上）は smallAssetIneligible でカウント', async () => {
    // 2026-04-01 取得で 40 万以上 → 要件外
    await db.fixedAssets.add(
      asset({
        id: 'big',
        name: 'high-end PC',
        acquisitionDate: '2026-04-01',
        acquisitionCost: '400000',
        depreciationMethod: 'small-asset-special',
      }),
    );
    const r = await generateYearEndDepreciation(2026);
    expect(r.created).toBe(1);
    expect(r.smallAssetIneligible).toBe(1);
  });

  test('2026-03 取得で 30 万以上は要件外', async () => {
    await db.fixedAssets.add(
      asset({
        acquisitionDate: '2026-03-31',
        acquisitionCost: '300000',
        depreciationMethod: 'small-asset-special',
      }),
    );
    const r = await generateYearEndDepreciation(2026);
    expect(r.smallAssetIneligible).toBe(1);
    expect(r.created).toBe(1);
  });

  test('閾値未満は仕訳作成、摘要に「措法28の2」付与', async () => {
    await db.fixedAssets.add(
      asset({
        id: 'pc',
        name: 'Mac mini',
        acquisitionDate: '2026-04-15',
        acquisitionCost: '250000',
        depreciationMethod: 'small-asset-special',
      }),
    );
    const r = await generateYearEndDepreciation(2026);
    expect(r.created).toBe(1);
    const entries = await db.journalEntries.toArray();
    expect(entries[0]?.description).toContain('措法28の2');
    const lines = await db.journalLines.toArray();
    const expense = lines.find((l) => l.accountCode === '5210');
    expect(expense?.amount).toBe('250000');
  });

  test('年合計 300 万円の上限：取得日昇順で打ち切り', async () => {
    // 40 万 × 8 個 = 320 万、上限 300 万なので 7 個目までで 280 万、8 個目は上限超過
    const acqs = [
      { id: 'a1', date: '2026-04-01', cost: '400000' },
      { id: 'a2', date: '2026-05-01', cost: '400000' },
      { id: 'a3', date: '2026-06-01', cost: '400000' },
      { id: 'a4', date: '2026-07-01', cost: '400000' },
      { id: 'a5', date: '2026-08-01', cost: '400000' },
      { id: 'a6', date: '2026-09-01', cost: '400000' },
      { id: 'a7', date: '2026-10-01', cost: '400000' },
      { id: 'a8', date: '2026-11-01', cost: '400000' },
    ];
    // 注意：40 万「未満」が閾値なので、400000 そのものは要件外。
    // このテストでは上限の挙動を確認するため、閾値未満（399999）を使う。
    for (const a of acqs) {
      await db.fixedAssets.add(
        asset({
          id: a.id,
          name: `asset-${a.id}`,
          acquisitionDate: a.date,
          acquisitionCost: '399999',
          depreciationMethod: 'small-asset-special',
        }),
      );
    }
    const r = await generateYearEndDepreciation(2026);
    // 399999 × 7 = 2,799,993（300 万以下）、+ 8 個目 → 3,199,992（300 万超）
    // なので 7 個作成、1 個上限超過
    expect(r.created).toBe(8);
    expect(r.smallAssetCapExceeded).toBe(1);
  });

  test('通常償却と少額特例の混在もカウントが正しい', async () => {
    await db.fixedAssets.bulkAdd([
      asset({
        id: 'small',
        name: 'iPhone',
        acquisitionDate: '2026-05-01',
        acquisitionCost: '150000',
        depreciationMethod: 'small-asset-special',
      }),
      asset({
        id: 'normal',
        name: 'Mac Studio',
        acquisitionDate: '2026-01-01',
        acquisitionCost: '500000',
        usefulLifeYears: 4,
        depreciationMethod: 'straight-line',
      }),
    ]);
    const r = await generateYearEndDepreciation(2026);
    expect(r.created).toBe(2);
    expect(r.smallAssetIneligible).toBe(0);
    expect(r.smallAssetCapExceeded).toBe(0);
  });
});

describe('既存データの既定の扱い（新しい項目が未設定なら従来と同じ）', () => {
  test('assetCategory・残価保証額が未設定なら 1 円残し（明示した 7 号と同じ結果）', () => {
    const base = asset({ acquisitionDate: '2026-01-01', usefulLifeYears: 4 });
    const explicit = asset({ ...base, assetCategory: 7 });
    for (const y of [2026, 2027, 2028, 2029, 2030]) {
      expect(computeDepreciation(base, y)).toEqual(computeDepreciation(explicit, y));
    }
    expect(computeDepreciation(base, 2029).bookValueEnd).toBe('1');
  });

  test('リース契約日だけ・残価保証額だけでは 2 号ハを適用しない', () => {
    const onlyDate = asset({ leaseContractDate: '2026-01-01' });
    const onlyGuarantee = asset({ residualGuaranteeAmount: '50000' });
    expect(computeDepreciation(onlyDate, 2029).bookValueEnd).toBe('1');
    expect(computeDepreciation(onlyGuarantee, 2029).bookValueEnd).toBe('1');
  });

  test('conversionBasis が未設定なら償却の基礎は acquisitionCost', () => {
    const r = computeDepreciation(asset({ acquisitionCost: '300000' }), 2026);
    expect(r.depreciationBase).toBe('300000');
    expect(r.amount).toBe('75000');
  });

  test('グループ合計を渡さなければ資産ごとに ÷3', () => {
    const a = asset({
      acquisitionDate: '2026-01-01',
      acquisitionCost: '100000',
      depreciationMethod: 'lump-sum',
      lumpSumPoolId: 'p',
    });
    expect(computeDepreciation(a, 2026).amount).toBe('33333');
    expect(computeDepreciation(a, 2028).amount).toBe('33334');
  });
});

describe('償却可能限度額（所令134条1項2号）', () => {
  test('8 号無形固定資産は期末簿価 0 まで償却する', () => {
    const a = asset({
      acquisitionDate: '2026-01-01',
      acquisitionCost: '1000000',
      usefulLifeYears: 5,
      assetCategory: 8,
      accountCode: '1516',
    });
    const last = computeDepreciation(a, 2030);
    expect(last.amount).toBe('200000');
    expect(last.bookValueEnd).toBe('0');
    expect(last.fullyDepreciated).toBe(true);
    expect(computeDepreciation(a, 2031).amount).toBe('0');
  });

  test('坑道は期末簿価 0 まで償却する', () => {
    const a = asset({
      acquisitionDate: '2026-01-01',
      acquisitionCost: '1000000',
      usefulLifeYears: 5,
      assetCategory: 2,
      isMineShaft: true,
    });
    expect(computeDepreciation(a, 2030).bookValueEnd).toBe('0');
  });

  test('2 号ハ：令和9年3月31日以前締結の所有権移転外リースは残価保証額まで', () => {
    const a = asset({
      acquisitionDate: '2026-01-01',
      acquisitionCost: '300000',
      usefulLifeYears: 4,
      leaseContractDate: '2027-03-31',
      residualGuaranteeAmount: '50000',
    });
    expect(depreciationLimit(a, D('300000')).toString()).toBe('250000');
    const r = computeDepreciation(a, 2029);
    expect(r.amount).toBe('25000');
    expect(r.bookValueEnd).toBe('50000');
    expect(r.fullyDepreciated).toBe(true);
  });

  test('2 号ハ：令和9年4月1日以後締結なら 2 号イ（1 円残し）', () => {
    const a = asset({
      leaseContractDate: '2027-04-01',
      residualGuaranteeAmount: '50000',
    });
    expect(depreciationLimit(a, D('300000')).toString()).toBe('299999');
  });
});

describe('旧償却方法（所令134条1項1号・2項）', () => {
  test('旧定額法＋1 号（建物）は取得価額の 95% で止まり、翌年以後 5 年で 1 円まで均等償却', () => {
    // 100 万円・耐用 2 年（旧定額法償却率 0.500）・残存価額 10 万円 → 年 450,000
    const a = asset({
      acquisitionDate: '2006-01-01',
      acquisitionCost: '1000000',
      usefulLifeYears: 2,
      depreciationMethod: 'old-straight-line',
      assetCategory: 1,
    });
    expect(computeDepreciation(a, 2006).amount).toBe('450000');
    expect(computeDepreciation(a, 2007).amount).toBe('450000');
    const reached = computeDepreciation(a, 2008);
    expect(reached.amount).toBe('50000');
    expect(reached.accumulatedEnd).toBe('950000');
    expect(reached.fullyDepreciated).toBe(false);
    // (1,000,000 − 950,000 − 1) ÷ 5 = 9,999.8 → 10,000
    for (const y of [2009, 2010, 2011, 2012]) {
      expect(computeDepreciation(a, y).amount).toBe('10000');
    }
    const last = computeDepreciation(a, 2013);
    expect(last.amount).toBe('9999');
    expect(last.bookValueEnd).toBe('1');
    expect(last.fullyDepreciated).toBe(true);
    expect(computeDepreciation(a, 2014).amount).toBe('0');
  });

  test('旧定額法＋8 号無形固定資産は全額まで償却し、5 年均等償却は適用しない', () => {
    const a = asset({
      acquisitionDate: '2006-01-01',
      acquisitionCost: '1000000',
      usefulLifeYears: 5,
      depreciationMethod: 'old-straight-line',
      assetCategory: 8,
    });
    expect(computeDepreciation(a, 2006).amount).toBe('200000');
    const last = computeDepreciation(a, 2010);
    expect(last.bookValueEnd).toBe('0');
    expect(last.fullyDepreciated).toBe(true);
    expect(computeDepreciation(a, 2011).amount).toBe('0');
  });

  test('旧定率法：未償却残高 × 旧定率法償却率、95% 到達後は 5 年均等償却', () => {
    const a = asset({
      acquisitionDate: '2006-01-01',
      acquisitionCost: '1000000',
      usefulLifeYears: 5,
      depreciationMethod: 'old-declining-balance',
      assetCategory: 7,
    });
    expect(computeDepreciation(a, 2006).amount).toBe('369000');
    expect(computeDepreciation(a, 2007).amount).toBe('232839');
    expect(computeDepreciation(a, 2012).bookValueEnd).toBe('50000');
    expect(computeDepreciation(a, 2013).amount).toBe('10000');
    expect(computeDepreciation(a, 2017).bookValueEnd).toBe('1');
  });

  test('5 年均等償却は平成20年分より前には始まらない', () => {
    // 耐用 2 年で 2004 取得 → 2006 に 95% 到達。2007 は 0、2008 から均等償却。
    const a = asset({
      acquisitionDate: '2004-01-01',
      acquisitionCost: '1000000',
      usefulLifeYears: 2,
      depreciationMethod: 'old-straight-line',
    });
    expect(computeDepreciation(a, 2006).accumulatedEnd).toBe('950000');
    expect(computeDepreciation(a, 2007).amount).toBe('0');
    expect(computeDepreciation(a, 2008).amount).toBe('10000');
  });

  test('残存価額（耐用年数省令別表第十一）：有形 10%、無形・坑道 0、牛馬は 10 万円と比べて少ない方', () => {
    expect(oldMethodResidualValue(D('1000000'), {}).toString()).toBe('100000');
    expect(oldMethodResidualValue(D('1000000'), { assetCategory: 8 }).toString()).toBe('0');
    expect(oldMethodResidualValue(D('1000000'), { isMineShaft: true }).toString()).toBe('0');
    expect(
      oldMethodResidualValue(
        D('1000000'),
        { assetCategory: 9 },
        { rate: '0.5', cattleOrHorse: true },
      ).toString(),
    ).toBe('100000');
    expect(
      oldMethodResidualValue(
        D('1000000'),
        { assetCategory: 9 },
        { rate: '0.05', cattleOrHorse: false },
      ).toString(),
    ).toBe('50000');
  });

  test('生物の旧償却方法は細目の残存割合が無いと計算しない', () => {
    const a = asset({
      acquisitionDate: '2006-01-01',
      depreciationMethod: 'old-straight-line',
      assetCategory: 9,
    });
    expect(() => computeDepreciation(a, 2006)).toThrow(/残存割合/);
  });
});

describe('一括償却資産のグループ（所令139条1項の一括償却対象額）', () => {
  test('同グループ 100,000 と 200,000 は各年の合計が 100,000', () => {
    const small = asset({
      id: 'p1',
      acquisitionDate: '2026-02-01',
      acquisitionCost: '100000',
      depreciationMethod: 'lump-sum',
      lumpSumPoolId: 'business-2026',
    });
    const large = asset({
      id: 'p2',
      acquisitionDate: '2026-05-01',
      acquisitionCost: '200000',
      depreciationMethod: 'lump-sum',
      lumpSumPoolId: 'business-2026',
    });
    const pools = lumpSumPoolShares([small, large]);
    for (const y of [2026, 2027, 2028]) {
      const total = D(computeDepreciation(small, y, pools.get('p1')).amount).plus(
        computeDepreciation(large, y, pools.get('p2')).amount,
      );
      expect(total.toString()).toBe('100000');
    }
    expect(computeDepreciation(small, 2028, pools.get('p1')).bookValueEnd).toBe('0');
    expect(computeDepreciation(large, 2028, pools.get('p2')).bookValueEnd).toBe('0');
  });

  test('グループ指定の無い一括償却資産・別年度の資産は同じグループにしない', () => {
    const pools = lumpSumPoolShares([
      asset({ id: 'x', depreciationMethod: 'lump-sum', acquisitionCost: '150000' }),
      asset({
        id: 'y',
        depreciationMethod: 'lump-sum',
        acquisitionCost: '150000',
        lumpSumPoolId: 'g',
        acquisitionDate: '2026-03-01',
      }),
      asset({
        id: 'z',
        depreciationMethod: 'lump-sum',
        acquisitionCost: '120000',
        lumpSumPoolId: 'g',
        acquisitionDate: '2027-03-01',
      }),
    ]);
    expect(pools.has('x')).toBe(false);
    expect(pools.get('y')).toEqual({ totalCost: '150000', precedingCost: '0' });
    expect(pools.get('z')).toEqual({ totalCost: '120000', precedingCost: '0' });
  });

  test('年末一括生成もグループで按分する', async () => {
    await db.fixedAssets.bulkAdd([
      asset({
        id: 'p1',
        acquisitionCost: '100000',
        depreciationMethod: 'lump-sum',
        lumpSumPoolId: 'g',
      }),
      asset({
        id: 'p2',
        acquisitionDate: '2026-06-01',
        acquisitionCost: '200000',
        depreciationMethod: 'lump-sum',
        lumpSumPoolId: 'g',
      }),
    ]);
    await generateYearEndDepreciation(2026);
    const expense = (await db.journalLines.toArray()).filter((l) => l.accountCode === '5210');
    const total = expense.reduce((sum, l) => sum.plus(l.amount), D(0));
    expect(total.toString()).toBe('100000');
  });
});

describe('所令138条1項の即時費用化', () => {
  test('既存の少額特例・取得価額 50,000・新しい項目なし → 取得年に全額、要件外に数えない', async () => {
    await db.fixedAssets.add(
      asset({
        id: 'cheap',
        name: 'マウス',
        acquisitionDate: '2026-05-01',
        acquisitionCost: '50000',
        depreciationMethod: 'small-asset-special',
      }),
    );
    const r = await generateYearEndDepreciation(2026);
    expect(r.created).toBe(1);
    expect(r.smallAssetIneligible).toBe(0);
    expect(r.smallAssetCapExceeded).toBe(0);
    const entries = await db.journalEntries.toArray();
    expect(entries[0]?.description).toContain('所令138');
    const expense = (await db.journalLines.toArray()).find((l) => l.accountCode === '5210');
    expect(expense?.amount).toBe('50000');
  });

  test('使用可能期間 1 年未満・取得価額 150,000 は方法を問わず取得年に全額', () => {
    for (const method of ['straight-line', 'lump-sum'] as const) {
      const a = asset({
        acquisitionDate: '2026-10-01',
        acquisitionCost: '150000',
        depreciationMethod: method,
        usableLifeUnderOneYear: true,
      });
      const r = computeDepreciation(a, 2026);
      expect(r.amount).toBe('150000');
      expect(r.bookValueEnd).toBe('0');
      expect(computeDepreciation(a, 2027).amount).toBe('0');
    }
  });

  test('所令138条の資産は少額特例の 300 万円枠を使わない', async () => {
    const dates = ['04', '05', '06', '07', '08', '09', '10', '11'].map((mm) => `2026-${mm}-01`);
    const assets = dates.map((date) =>
      asset({
        id: date,
        acquisitionDate: date,
        acquisitionCost: '399999',
        depreciationMethod: 'small-asset-special',
      }),
    );
    await db.fixedAssets.bulkAdd([
      ...assets,
      asset({
        id: 'cheap',
        acquisitionDate: '2026-01-01',
        acquisitionCost: '50000',
        depreciationMethod: 'small-asset-special',
      }),
    ]);
    const r = await generateYearEndDepreciation(2026);
    expect(r.created).toBe(9);
    expect(r.smallAssetCapExceeded).toBe(1);
  });
});

describe('少額特例の要件（措法28の2・措令18条の5）', () => {
  test('取得日で従業員数の上限が 500 人／400 人に分かれる', async () => {
    await db.fixedAssets.bulkAdd([
      asset({
        id: 'before',
        acquisitionDate: '2026-03-31',
        acquisitionCost: '200000',
        depreciationMethod: 'small-asset-special',
        employeeCountAtAcquisition: 450,
      }),
      asset({
        id: 'after',
        acquisitionDate: '2026-04-01',
        acquisitionCost: '200000',
        depreciationMethod: 'small-asset-special',
        employeeCountAtAcquisition: 450,
      }),
    ]);
    const r = await generateYearEndDepreciation(2026);
    expect(r.created).toBe(2);
    expect(r.smallAssetIneligible).toBe(1);
  });

  test('従業員数が未設定なら従来どおり適用', async () => {
    await db.fixedAssets.add(
      asset({
        acquisitionDate: '2026-04-01',
        acquisitionCost: '200000',
        depreciationMethod: 'small-asset-special',
      }),
    );
    const r = await generateYearEndDepreciation(2026);
    expect(r.created).toBe(1);
    expect(r.smallAssetIneligible).toBe(0);
  });

  test('貸付け用（主要な業務以外）は少額特例の要件外', async () => {
    await db.fixedAssets.add(
      asset({
        acquisitionDate: '2026-04-01',
        acquisitionCost: '200000',
        depreciationMethod: 'small-asset-special',
        isLeasedOut: true,
      }),
    );
    const r = await generateYearEndDepreciation(2026);
    expect(r.created).toBe(1);
    expect(r.smallAssetIneligible).toBe(1);
  });

  test('開業日 2026-07-01 なら上限は 6 か月分の 1,500,000', async () => {
    for (const date of ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01']) {
      await db.fixedAssets.add(
        asset({
          id: date,
          acquisitionDate: date,
          acquisitionCost: '399999',
          depreciationMethod: 'small-asset-special',
        }),
      );
    }
    // 399,999 × 3 = 1,199,997、4 件目で 1,599,996 となり 1,500,000 を超える
    const r = await generateYearEndDepreciation(2026, { businessStartDate: '2026-07-01' });
    expect(r.created).toBe(4);
    expect(r.smallAssetCapExceeded).toBe(1);
  });

  test('開業日は開業設定の開業仕訳の日付から取る', async () => {
    await db.journalEntries.add({
      id: 'opening',
      date: '2026-07-01',
      year: 2026,
      description: '開業費計上（開業設定）',
      status: 'confirmed',
      source: 'opening',
      createdAt: 0,
      confirmedAt: 0,
    });
    for (const date of ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01']) {
      await db.fixedAssets.add(
        asset({
          id: date,
          acquisitionDate: date,
          acquisitionCost: '399999',
          depreciationMethod: 'small-asset-special',
        }),
      );
    }
    const r = await generateYearEndDepreciation(2026);
    expect(r.created).toBe(4);
    expect(r.smallAssetCapExceeded).toBe(1);
  });

  test('廃業日 2026-09-30 なら上限は 9 か月分の 2,250,000', async () => {
    for (let i = 0; i < 6; i++) {
      await db.fixedAssets.add(
        asset({
          id: `s${i}`,
          acquisitionDate: `2026-0${i + 4}-01`,
          acquisitionCost: '399999',
          depreciationMethod: 'small-asset-special',
        }),
      );
    }
    // 399,999 × 5 = 1,999,995、6 件目で 2,399,994 となり 2,250,000 を超える
    const r = await generateYearEndDepreciation(2026, { businessCloseDate: '2026-09-30' });
    expect(r.created).toBe(6);
    expect(r.smallAssetCapExceeded).toBe(1);
  });
});

describe('転用資産（所令135条）は原始取得価額を年額・保証額の基準にする', () => {
  test('定額法・耐用10年、原始1,000,000・転用日600,000 → 年額100,000、第6年99,999、以後0', () => {
    const a = asset({
      acquisitionDate: '2020-01-01',
      acquisitionCost: '1000000',
      conversionBasis: '600000',
      serviceStartDate: '2026-01-01',
      usefulLifeYears: 10,
      depreciationMethod: 'straight-line',
    });
    expect(computeDepreciation(a, 2026).amount).toBe('100000');
    expect(computeDepreciation(a, 2030).amount).toBe('100000');
    expect(computeDepreciation(a, 2031).amount).toBe('99999');
    expect(computeDepreciation(a, 2031).fullyDepreciated).toBe(true);
    expect(computeDepreciation(a, 2032).amount).toBe('0');
  });

  test('定率法・耐用10年、原始1,000,000・転用日600,000 → 初年120,000、保証額65,520、第4年に改定償却率へ切替', () => {
    const a = asset({
      acquisitionDate: '2020-01-01',
      acquisitionCost: '1000000',
      conversionBasis: '600000',
      serviceStartDate: '2026-01-01',
      usefulLifeYears: 10,
      depreciationMethod: 'declining-balance',
    });
    expect(computeDepreciation(a, 2026).amount).toBe('120000');
    expect(computeDepreciation(a, 2027).amount).toBe('96000');
    expect(computeDepreciation(a, 2028).amount).toBe('76800');
    const y4 = computeDepreciation(a, 2029);
    expect(y4.amount).toBe('76800');
    expect(y4.depreciationBase).toBe('307200');
  });

  test('旧定率法の転用資産は原始取得価額の95%到達（償却済みとみなされる差額を含む）で5年均等へ、基礎は原始5%−1', () => {
    const a = asset({
      acquisitionDate: '2006-01-01',
      acquisitionCost: '1000000',
      conversionBasis: '600000',
      serviceStartDate: '2007-01-01',
      usefulLifeYears: 5,
      depreciationMethod: 'old-declining-balance',
      assetCategory: 7,
    });
    let reachedFiveYear = false;
    let fiveYearAmount = '';
    for (let y = 2007; y <= 2012; y++) {
      const r = computeDepreciation(a, y);
      if (D(r.accumulatedEnd).plus('400000').equals('950000')) {
        reachedFiveYear = true;
      }
      if (reachedFiveYear) {
        fiveYearAmount = computeDepreciation(a, y + 1).amount;
        break;
      }
    }
    expect(reachedFiveYear).toBe(true);
    // (1,000,000 − 950,000 − 1) ÷ 5 = 9,999.8 → 10,000（端数は最終年で調整）
    expect(['10000', '9999']).toContain(fiveYearAmount);
  });
});

describe('旧定率法償却率テーブルは耐用年数2〜100年', () => {
  test('耐用30年は0.074、2〜100年で例外を投げない', () => {
    const a = asset({
      acquisitionDate: '2006-01-01',
      acquisitionCost: '1000000',
      usefulLifeYears: 30,
      depreciationMethod: 'old-declining-balance',
    });
    expect(computeDepreciation(a, 2006).amount).toBe('74000');
    for (let years = 2; years <= 100; years++) {
      expect(() =>
        computeDepreciation(
          asset({ usefulLifeYears: years, depreciationMethod: 'old-declining-balance' }),
          2026,
        ),
      ).not.toThrow();
    }
  });
});

describe('リース期間定額法（所令120条の2第1項6号）', () => {
  test('取得価額1,200,000・リース期間60か月・当年使用6か月 → 120,000', () => {
    const a = asset({
      acquisitionDate: '2026-07-01',
      acquisitionCost: '1200000',
      depreciationMethod: 'lease-period-straight-line',
      leaseTermMonths: 60,
    });
    expect(computeDepreciation(a, 2026).amount).toBe('120000');
  });

  test('残価保証200,000・契約2027-03-31以前 → 100,000', () => {
    const a = asset({
      acquisitionDate: '2026-07-01',
      acquisitionCost: '1200000',
      depreciationMethod: 'lease-period-straight-line',
      leaseTermMonths: 60,
      leaseContractDate: '2027-03-31',
      residualGuaranteeAmount: '200000',
    });
    expect(computeDepreciation(a, 2026).amount).toBe('100000');
  });

  test('契約2027-04-01以後は残価保証を減じない → 120,000', () => {
    const a = asset({
      acquisitionDate: '2026-07-01',
      acquisitionCost: '1200000',
      depreciationMethod: 'lease-period-straight-line',
      leaseTermMonths: 60,
      leaseContractDate: '2027-04-01',
      residualGuaranteeAmount: '200000',
    });
    expect(computeDepreciation(a, 2026).amount).toBe('120000');
  });
});

describe('少額特例の落選資産は通常償却へ切替', () => {
  test('上限超過資産は定額法で当年償却し、翌年も継続する', async () => {
    const dates = ['04-01', '05-01', '06-01', '07-01', '08-01', '09-01', '10-01', '11-01'];
    for (const d of dates) {
      await db.fixedAssets.add(
        asset({
          id: d,
          acquisitionDate: `2026-${d}`,
          acquisitionCost: '390000',
          depreciationMethod: 'small-asset-special',
        }),
      );
    }
    const r2026 = await generateYearEndDepreciation(2026);
    expect(r2026.created).toBe(8);
    expect(r2026.smallAssetCapExceeded).toBe(1);
    const eighth = await db.fixedAssets.get('11-01');
    const entries2026 = await db.journalEntries.where('year').equals(2026).toArray();
    const eighthTag = `#${eighth!.id.slice(0, 8)}`;
    const eighthEntry = entries2026.find((e) => e.description.includes(eighthTag));
    expect(eighthEntry?.description).not.toContain('措法28の2');
    expect(eighthEntry?.description).not.toContain('未作成');
    const r2027 = await generateYearEndDepreciation(2027);
    expect(r2027.created).toBeGreaterThan(0);
    const entries2027 = await db.journalEntries.where('year').equals(2027).toArray();
    expect(entries2027.some((e) => e.description.includes(eighthTag))).toBe(true);
  });

  test('decliningBalanceElected=true の落選資産は定率法で償却する', async () => {
    const dates = ['04-01', '05-01', '06-01', '07-01', '08-01', '09-01', '10-01', '11-01'];
    for (const d of dates) {
      await db.fixedAssets.add(
        asset({
          id: `dbe-${d}`,
          acquisitionDate: `2026-${d}`,
          acquisitionCost: '390000',
          depreciationMethod: 'small-asset-special',
          ...(d === '11-01' ? { decliningBalanceElected: true } : {}),
          usefulLifeYears: 4,
        }),
      );
    }
    const r = await generateYearEndDepreciation(2026);
    expect(r.created).toBe(8);
    const eighth = await db.fixedAssets.get('dbe-11-01');
    const lines = await db.journalLines.toArray();
    const entries = await db.journalEntries.toArray();
    const tag = `#${eighth!.id.slice(0, 8)}`;
    const entry = entries.find((e) => e.description.includes(tag));
    const line = lines.find((l) => l.entryId === entry?.id && l.accountCode === '5210');
    // 定率法・耐用4年（率0.5）、取得月11月なので月按分（390000×0.5×2/12=32500）
    expect(line?.amount).toBe('32500');
  });
});

describe('旧定率法償却率テーブルは耐用年数省令別表第七の値と1件ずつ一致する', () => {
  test('2〜100年、qa/tax-sources/49_taiyonensu_shourei_beppyo7_8.md の転記値と一致（式ではなく条文の表そのもの）', () => {
    // 別表第七「旧定率法」列を1件ずつ書き写した参照値（コードの定数とは独立に、
    // このテストファイル内に別途書き写す。式による算出はしない）。
    const STATUTE_OLD_DECLINING_RATE: Record<number, string> = {
      2: '0.684',
      3: '0.536',
      4: '0.438',
      5: '0.369',
      6: '0.319',
      7: '0.280',
      8: '0.250',
      9: '0.226',
      10: '0.206',
      11: '0.189',
      12: '0.175',
      13: '0.162',
      14: '0.152',
      15: '0.142',
      16: '0.134',
      17: '0.127',
      18: '0.120',
      19: '0.114',
      20: '0.109',
      21: '0.104',
      22: '0.099',
      23: '0.095',
      24: '0.092',
      25: '0.088',
      26: '0.085',
      27: '0.082',
      28: '0.079',
      29: '0.076',
      30: '0.074',
      31: '0.072',
      32: '0.069',
      33: '0.067',
      34: '0.066',
      35: '0.064',
      36: '0.062',
      37: '0.060',
      38: '0.059',
      39: '0.057',
      40: '0.056',
      41: '0.055',
      42: '0.053',
      43: '0.052',
      44: '0.051',
      45: '0.050',
      46: '0.049',
      47: '0.048',
      48: '0.047',
      49: '0.046',
      50: '0.045',
      51: '0.044',
      52: '0.043',
      53: '0.043',
      54: '0.042',
      55: '0.041',
      56: '0.040',
      57: '0.040',
      58: '0.039',
      59: '0.038',
      60: '0.038',
      61: '0.037',
      62: '0.036',
      63: '0.036',
      64: '0.035',
      65: '0.035',
      66: '0.034',
      67: '0.034',
      68: '0.033',
      69: '0.033',
      70: '0.032',
      71: '0.032',
      72: '0.032',
      73: '0.031',
      74: '0.031',
      75: '0.030',
      76: '0.030',
      77: '0.030',
      78: '0.029',
      79: '0.029',
      80: '0.028',
      81: '0.028',
      82: '0.028',
      83: '0.027',
      84: '0.027',
      85: '0.026',
      86: '0.026',
      87: '0.026',
      88: '0.026',
      89: '0.026',
      90: '0.025',
      91: '0.025',
      92: '0.025',
      93: '0.025',
      94: '0.024',
      95: '0.024',
      96: '0.024',
      97: '0.023',
      98: '0.023',
      99: '0.023',
      100: '0.023',
    };
    for (let years = 2; years <= 100; years++) {
      expect(oldDecliningBalanceRate(years), `耐用年数 ${years} 年`).toBe(
        STATUTE_OLD_DECLINING_RATE[years],
      );
    }
  });
});
describe('少額特例の年度上限累計は原始取得価額で計る（転用資産も所令126条の取得価額）', () => {
  test('先頭の転用資産（原始390,000・転用日価額100）を原始取得価額で数えると、8件目が上限超過で落選する', () => {
    const converted = asset({
      id: 'converted',
      acquisitionDate: '2026-04-01',
      acquisitionCost: '390000',
      conversionBasis: '100',
      serviceStartDate: '2026-04-01',
      depreciationMethod: 'small-asset-special',
    });
    const normals = ['05-01', '06-01', '07-01', '08-01', '09-01', '10-01', '11-01'].map((d, i) =>
      asset({
        id: `n${i}`,
        acquisitionDate: `2026-${d}`,
        acquisitionCost: '390000',
        depreciationMethod: 'small-asset-special',
      }),
    );
    // 転用日価額（100）で数えると合計 2,730,100 で 300 万円の上限に達しないが、
    // 原始取得価額（390,000）で数えると 8 件目（2026-11-01、n6）で 3,120,000 となり上限超過。
    const statuses = smallAssetSpecialStatuses([converted, ...normals]);
    expect(statuses.get('converted')).toBe('applicable');
    for (const n of normals.slice(0, 6)) {
      expect(statuses.get(n.id)).toBe('applicable');
    }
    expect(statuses.get('n6')).toBe('cap-exceeded');
  });
});
