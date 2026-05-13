import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { db } from '../db/db'
import { newId } from '../lib/id'
import {
  computeDepreciation,
  generateYearEndDepreciation,
} from './depreciation'
import type { FixedAsset } from '../db/types'

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
  }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

describe('computeDepreciation - straight-line', () => {
  test('全期間取得：年額 ≈ (cost - 1) / years', () => {
    // 300,000 円、4 年、1 月取得 → 各年 (300000-1)/4 = 74,999.75 → 75,000（half-up）
    const r = computeDepreciation(
      asset({ acquisitionDate: '2026-01-01' }),
      2026
    )
    expect(r.amount).toBe('75000')
  })

  test('取得月按分：4 月取得は初年度 9 ヶ月分', () => {
    // 300,000 円、4 年、4 月取得 → 初年度 (75000/12)*9 = 56,250
    const r = computeDepreciation(
      asset({ acquisitionDate: '2026-04-15' }),
      2026
    )
    expect(r.amount).toBe('56250')
  })

  test('翌年は満年度償却', () => {
    const r = computeDepreciation(
      asset({ acquisitionDate: '2026-04-15' }),
      2027
    )
    expect(r.amount).toBe('75000')
  })

  test('取得前の年は償却額 0', () => {
    const r = computeDepreciation(
      asset({ acquisitionDate: '2026-04-15' }),
      2025
    )
    expect(r.amount).toBe('0')
    expect(r.bookValueEnd).toBe('300000')
  })

  test('残存簿価 1 円残し：最終年度は端数を上限', () => {
    // 2026/01 取得、4 年。標準年額 75,000、償却可能残 = 299,999。
    // 年度ごと：75000 / 75000 / 75000 → 累計 225,000、残 74,999
    // 4 年目：min(75000, 74999) = 74999、累計 299999、簿価 1
    const a = asset({
      acquisitionDate: '2026-01-01',
      acquisitionCost: '300000',
      usefulLifeYears: 4,
    })
    const r2029 = computeDepreciation(a, 2029)
    expect(r2029.amount).toBe('74999')
    expect(r2029.accumulatedEnd).toBe('299999')
    expect(r2029.bookValueEnd).toBe('1')
    expect(r2029.fullyDepreciated).toBe(true)
  })

  test('完全償却後の年は償却額 0、簿価は 1 円維持', () => {
    const a = asset({
      acquisitionDate: '2026-01-01',
      acquisitionCost: '300000',
      usefulLifeYears: 4,
    })
    const r = computeDepreciation(a, 2030)
    expect(r.amount).toBe('0')
    expect(r.bookValueEnd).toBe('1')
    expect(r.fullyDepreciated).toBe(true)
  })

  test('除却後の年は償却なし', () => {
    const a = asset({
      acquisitionDate: '2026-01-01',
      disposedDate: '2027-06-30',
    })
    const r = computeDepreciation(a, 2028)
    expect(r.amount).toBe('0')
  })

})

describe('computeDepreciation - declining-balance (200%)', () => {
  test('耐用年数 5 年・1月取得・初年度', () => {
    const a = asset({
      acquisitionDate: '2026-01-01',
      acquisitionCost: '1000000',
      usefulLifeYears: 5,
      depreciationMethod: 'declining-balance',
    })
    const r = computeDepreciation(a, 2026)
    // 1,000,000 × 0.400 × 12/12 = 400,000
    expect(r.amount).toBe('400000')
    expect(r.bookValueEnd).toBe('600000')
  })

  test('耐用年数 5 年・1月取得・2年目', () => {
    const a = asset({
      acquisitionDate: '2026-01-01',
      acquisitionCost: '1000000',
      usefulLifeYears: 5,
      depreciationMethod: 'declining-balance',
    })
    const r = computeDepreciation(a, 2027)
    // 期首簿価 600,000 × 0.400 = 240,000
    expect(r.amount).toBe('240000')
    expect(r.bookValueEnd).toBe('360000')
  })

  test('耐用年数 5 年・1月取得・最終年で残存簿価 1 円に収束', () => {
    const a = asset({
      acquisitionDate: '2026-01-01',
      acquisitionCost: '1000000',
      usefulLifeYears: 5,
      depreciationMethod: 'declining-balance',
    })
    const r = computeDepreciation(a, 2030)
    expect(r.bookValueEnd).toBe('1')
    expect(r.fullyDepreciated).toBe(true)
  })

  test('耐用年数 5 年・7月取得は月按分', () => {
    const a = asset({
      acquisitionDate: '2026-07-01',
      acquisitionCost: '1000000',
      usefulLifeYears: 5,
      depreciationMethod: 'declining-balance',
    })
    const r = computeDepreciation(a, 2026)
    // 1,000,000 × 0.400 × 6/12 = 200,000
    expect(r.amount).toBe('200000')
  })

  test('未登録の耐用年数で throw', () => {
    expect(() =>
      computeDepreciation(
        asset({ usefulLifeYears: 25, depreciationMethod: 'declining-balance' }),
        2026
      )
    ).toThrow(/償却率テーブル/)
  })

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
    })
    const r4 = computeDepreciation(a, 2029)
    expect(r4.amount).toBe('108000')
  })
})

describe('generateYearEndDepreciation', () => {
  test('全資産分の仕訳を作成し、件数を返す', async () => {
    await db.fixedAssets.bulkAdd([
      asset({ id: 'a1', name: 'PC', acquisitionCost: '300000', usefulLifeYears: 4, acquisitionDate: '2026-01-01' }),
      asset({ id: 'a2', name: 'デスク', acquisitionCost: '60000', usefulLifeYears: 6, acquisitionDate: '2026-01-01' }),
    ])

    const r = await generateYearEndDepreciation(2026)
    expect(r.created).toBe(2)

    const entries = await db.journalEntries.toArray()
    expect(entries).toHaveLength(2)
    expect(entries.every((e) => e.date === '2026-12-31')).toBe(true)

    const lines = await db.journalLines.toArray()
    expect(lines).toHaveLength(4)
    const expense = lines.filter((l) => l.accountCode === '5210')
    const accumulated = lines.filter((l) => l.accountCode === '1520')
    expect(expense).toHaveLength(2)
    expect(accumulated).toHaveLength(2)
    expect(expense.every((l) => l.side === 'debit')).toBe(true)
    expect(accumulated.every((l) => l.side === 'credit')).toBe(true)
  })

  test('償却額 0 の資産はスキップ', async () => {
    await db.fixedAssets.add(
      asset({ acquisitionDate: '2027-01-01' })  // 2026 年度は取得前
    )
    const r = await generateYearEndDepreciation(2026)
    expect(r.created).toBe(0)
  })

  test('再実行：既存仕訳は skipped でカウント', async () => {
    await db.fixedAssets.add(
      asset({ id: 'a1', name: 'PC', acquisitionDate: '2026-01-01' })
    )
    await generateYearEndDepreciation(2026)
    const r = await generateYearEndDepreciation(2026)
    expect(r.created).toBe(0)
    expect(r.skipped).toBe(1)
  })
})

describe('computeDepreciation - small-asset-special', () => {
  test('取得年度に全額損金、簿価 0', () => {
    const a = asset({
      acquisitionDate: '2026-04-01',
      acquisitionCost: '350000',
      depreciationMethod: 'small-asset-special',
    })
    const r = computeDepreciation(a, 2026)
    expect(r.amount).toBe('350000')
    expect(r.accumulatedEnd).toBe('350000')
    expect(r.bookValueEnd).toBe('0')
    expect(r.fullyDepreciated).toBe(true)
  })

  test('取得年度以降は償却 0', () => {
    const a = asset({
      acquisitionDate: '2026-04-01',
      acquisitionCost: '350000',
      depreciationMethod: 'small-asset-special',
    })
    const r = computeDepreciation(a, 2027)
    expect(r.amount).toBe('0')
    expect(r.bookValueEnd).toBe('0')
  })

  test('取得月按分なし（即時全額）', () => {
    // 通常の定額/定率法と違って、月按分なしで全額損金
    const a = asset({
      acquisitionDate: '2026-12-15',
      acquisitionCost: '399000',
      depreciationMethod: 'small-asset-special',
    })
    const r = computeDepreciation(a, 2026)
    expect(r.amount).toBe('399000')
  })
})

describe('generateYearEndDepreciation - small-asset-special', () => {
  test('適用要件外（取得価額が閾値以上）は smallAssetIneligible でカウント', async () => {
    // 2026-04-01 取得で 40 万以上 → 要件外
    await db.fixedAssets.add(
      asset({
        id: 'big',
        name: 'high-end PC',
        acquisitionDate: '2026-04-01',
        acquisitionCost: '400000',
        depreciationMethod: 'small-asset-special',
      })
    )
    const r = await generateYearEndDepreciation(2026)
    expect(r.created).toBe(0)
    expect(r.smallAssetIneligible).toBe(1)
  })

  test('2026-03 取得で 30 万以上は要件外', async () => {
    await db.fixedAssets.add(
      asset({
        acquisitionDate: '2026-03-31',
        acquisitionCost: '300000',
        depreciationMethod: 'small-asset-special',
      })
    )
    const r = await generateYearEndDepreciation(2026)
    expect(r.smallAssetIneligible).toBe(1)
    expect(r.created).toBe(0)
  })

  test('閾値未満は仕訳作成、摘要に「措法28の2」付与', async () => {
    await db.fixedAssets.add(
      asset({
        id: 'pc',
        name: 'Mac mini',
        acquisitionDate: '2026-04-15',
        acquisitionCost: '250000',
        depreciationMethod: 'small-asset-special',
      })
    )
    const r = await generateYearEndDepreciation(2026)
    expect(r.created).toBe(1)
    const entries = await db.journalEntries.toArray()
    expect(entries[0]?.description).toContain('措法28の2')
    const lines = await db.journalLines.toArray()
    const expense = lines.find((l) => l.accountCode === '5210')
    expect(expense?.amount).toBe('250000')
  })

  test('年合計 300 万円 cap：取得日昇順で打ち切り', async () => {
    // 40 万 × 8 個 = 320 万、上限 300 万なので 7 個目までで 280 万、8 個目は cap 超過
    const acqs = [
      { id: 'a1', date: '2026-04-01', cost: '400000' },
      { id: 'a2', date: '2026-05-01', cost: '400000' },
      { id: 'a3', date: '2026-06-01', cost: '400000' },
      { id: 'a4', date: '2026-07-01', cost: '400000' },
      { id: 'a5', date: '2026-08-01', cost: '400000' },
      { id: 'a6', date: '2026-09-01', cost: '400000' },
      { id: 'a7', date: '2026-10-01', cost: '400000' },
      { id: 'a8', date: '2026-11-01', cost: '400000' },
    ]
    // 注意：40 万「未満」が閾値なので、400000 そのものは要件外。
    // この test では「cap」の挙動を確認するため、閾値未満（399999）を使う。
    for (const a of acqs) {
      await db.fixedAssets.add(
        asset({
          id: a.id,
          name: `asset-${a.id}`,
          acquisitionDate: a.date,
          acquisitionCost: '399999',
          depreciationMethod: 'small-asset-special',
        })
      )
    }
    const r = await generateYearEndDepreciation(2026)
    // 399999 × 7 = 2,799,993（300 万以下）、+ 8 個目 → 3,199,992（300 万超）
    // なので 7 個 created、1 個 cap 超過
    expect(r.created).toBe(7)
    expect(r.smallAssetCapExceeded).toBe(1)
  })

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
    ])
    const r = await generateYearEndDepreciation(2026)
    expect(r.created).toBe(2)
    expect(r.smallAssetIneligible).toBe(0)
    expect(r.smallAssetCapExceeded).toBe(0)
  })
})