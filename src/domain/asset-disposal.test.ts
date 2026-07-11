import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { db } from '../db/db'
import { newId } from '../lib/id'
import { D } from '../lib/decimal'
import {
  buildDisposalLines,
  disposalBookValue,
  estimateTransferIncome,
  generateDisposalEntry,
} from './asset-disposal'
import type { FixedAsset } from '../db/types'

function asset(overrides: Partial<FixedAsset> = {}): FixedAsset {
  return {
    id: newId(),
    name: 'テスト什器',
    acquisitionDate: '2022-01-01',
    acquisitionCost: '1000000',
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

describe('buildDisposalLines（除却）', () => {
  test('帳簿価額が残っている場合、除却損＋累計償却＋資産で貸借一致する', () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'scrap' })
    const lines = buildDisposalLines(a)
    const { accumulatedEnd, bookValueEnd } = disposalBookValue(a)
    expect(D(bookValueEnd).greaterThan(0)).toBe(true)
    const debit = lines.filter((l) => l.side === 'debit').reduce((s, l) => s.plus(l.amount), D(0))
    const credit = lines.filter((l) => l.side === 'credit').reduce((s, l) => s.plus(l.amount), D(0))
    expect(debit.toString()).toBe(credit.toString())
    expect(lines).toContainEqual({ side: 'debit', accountCode: '5280', amount: bookValueEnd })
    expect(lines).toContainEqual({ side: 'debit', accountCode: '1520', amount: accumulatedEnd })
    expect(lines).toContainEqual({ side: 'credit', accountCode: '1510', amount: '1000000' })
  })

  test('少額特例で帳簿価額 0 なら除却損は計上しない', () => {
    const a = asset({
      depreciationMethod: 'small-asset-special',
      acquisitionCost: '150000',
      disposedDate: '2027-01-01',
      disposalType: 'scrap',
    })
    const { bookValueEnd } = disposalBookValue(a)
    expect(bookValueEnd).toBe('0')
    const lines = buildDisposalLines(a)
    expect(lines.some((l) => l.accountCode === '5280')).toBe(false)
  })

  test('disposedDate 未設定なら例外', () => {
    expect(() => buildDisposalLines(asset())).toThrow()
  })

  test('一括償却資産は対応対象外で例外', () => {
    const a = asset({
      depreciationMethod: 'lump-sum',
      acquisitionCost: '150000',
      disposedDate: '2022-06-01',
    })
    expect(() => buildDisposalLines(a)).toThrow()
  })
})

describe('buildDisposalLines（売却）', () => {
  test('売却価格が帳簿価額を上回る（益）→ 事業主借に差額', () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'sale' })
    const { bookValueEnd } = disposalBookValue(a)
    const salePrice = D(bookValueEnd).plus(100000).toString()
    const lines = buildDisposalLines(asset({ ...a, disposalType: 'sale', salePrice }))
    const debit = lines.filter((l) => l.side === 'debit').reduce((s, l) => s.plus(l.amount), D(0))
    const credit = lines.filter((l) => l.side === 'credit').reduce((s, l) => s.plus(l.amount), D(0))
    expect(debit.toString()).toBe(credit.toString())
    expect(lines).toContainEqual({ side: 'credit', accountCode: '3120', amount: '100000' })
    expect(lines.some((l) => l.accountCode === '1610')).toBe(false)
  })

  test('売却価格が帳簿価額を下回る（損）→ 事業主貸に差額', () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'sale' })
    const { bookValueEnd } = disposalBookValue(a)
    const salePrice = D(bookValueEnd).minus(50000).toString()
    const lines = buildDisposalLines(asset({ ...a, disposalType: 'sale', salePrice }))
    const debit = lines.filter((l) => l.side === 'debit').reduce((s, l) => s.plus(l.amount), D(0))
    const credit = lines.filter((l) => l.side === 'credit').reduce((s, l) => s.plus(l.amount), D(0))
    expect(debit.toString()).toBe(credit.toString())
    expect(lines).toContainEqual({ side: 'debit', accountCode: '1610', amount: '50000' })
    expect(lines.some((l) => l.accountCode === '3120')).toBe(false)
  })

  test('売却価格が帳簿価額と一致（損益なし）→ 事業主科目は使わない', () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'sale' })
    const { bookValueEnd } = disposalBookValue(a)
    const lines = buildDisposalLines(asset({ ...a, disposalType: 'sale', salePrice: bookValueEnd }))
    expect(lines.some((l) => l.accountCode === '1610' || l.accountCode === '3120')).toBe(false)
    const debit = lines.filter((l) => l.side === 'debit').reduce((s, l) => s.plus(l.amount), D(0))
    const credit = lines.filter((l) => l.side === 'credit').reduce((s, l) => s.plus(l.amount), D(0))
    expect(debit.toString()).toBe(credit.toString())
  })

  test('売却なのに salePrice 未設定なら例外', () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'sale' })
    expect(() => buildDisposalLines(a)).toThrow()
  })

  test('損益に関わらず損益計算書科目（収益・費用）は一切使わない', () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'sale', salePrice: '2000000' })
    const lines = buildDisposalLines(a)
    expect(lines.every((l) => !l.accountCode.startsWith('4') && !l.accountCode.startsWith('5'))).toBe(
      true
    )
  })
})

describe('generateDisposalEntry', () => {
  test('除却仕訳を作成し、貸借が一致する', async () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'scrap' })
    await db.fixedAssets.add(a)
    const result = await generateDisposalEntry(a.id)
    expect(result.created).toBe(true)
    const entries = await db.journalEntries.where({ year: 2023 }).toArray()
    expect(entries).toHaveLength(1)
    const lines = await db.journalLines.where('entryId').equals(entries[0]!.id).toArray()
    const debit = lines
      .filter((l) => l.side === 'debit')
      .reduce((s, l) => s.plus(l.amount), D(0))
    const credit = lines
      .filter((l) => l.side === 'credit')
      .reduce((s, l) => s.plus(l.amount), D(0))
    expect(debit.toString()).toBe(credit.toString())
  })

  test('2回目は重複としてスキップする', async () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'scrap' })
    await db.fixedAssets.add(a)
    await generateDisposalEntry(a.id)
    const second = await generateDisposalEntry(a.id)
    expect(second).toEqual({ created: false, reason: 'already-exists' })
    const entries = await db.journalEntries.where({ year: 2023 }).toArray()
    expect(entries).toHaveLength(1)
  })

  test('disposedDate 未設定なら no-disposal', async () => {
    const a = asset()
    await db.fixedAssets.add(a)
    const result = await generateDisposalEntry(a.id)
    expect(result).toEqual({ created: false, reason: 'no-disposal' })
  })

  test('売却で salePrice 未設定なら missing-sale-price', async () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'sale' })
    await db.fixedAssets.add(a)
    const result = await generateDisposalEntry(a.id)
    expect(result).toEqual({ created: false, reason: 'missing-sale-price' })
  })

  test('一括償却資産は lump-sum-unsupported', async () => {
    const a = asset({
      depreciationMethod: 'lump-sum',
      acquisitionCost: '150000',
      disposedDate: '2022-06-01',
    })
    await db.fixedAssets.add(a)
    const result = await generateDisposalEntry(a.id)
    expect(result).toEqual({ created: false, reason: 'lump-sum-unsupported' })
  })
})

describe('estimateTransferIncome', () => {
  test('売却時のみ試算を返す（益のケース）', () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'sale' })
    const { bookValueEnd } = disposalBookValue(a)
    const salePrice = D(bookValueEnd).plus(200000).toString()
    const est = estimateTransferIncome(asset({ ...a, disposalType: 'sale', salePrice }))
    expect(est).not.toBeNull()
    expect(est!.estimate).toBe('200000')
    expect(est!.holdingYears).toBe(1)
  })

  test('譲渡費用を控除する', () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'sale' })
    const { bookValueEnd } = disposalBookValue(a)
    const salePrice = D(bookValueEnd).plus(200000).toString()
    const est = estimateTransferIncome(
      asset({ ...a, disposalType: 'sale', salePrice, saleExpenses: '30000' })
    )
    expect(est!.estimate).toBe('170000')
  })

  test('除却（scrap）なら null', () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'scrap' })
    expect(estimateTransferIncome(a)).toBeNull()
  })

  test('未売却（disposedDate 無し）なら null', () => {
    expect(estimateTransferIncome(asset())).toBeNull()
  })

  function holdingYears(acquisitionDate: string, disposedDate: string): number {
    const a = asset({
      acquisitionDate,
      disposedDate,
      disposalType: 'sale',
      salePrice: '1',
    })
    return estimateTransferIncome(a)!.holdingYears
  }
  // 応当日基準の暦計算：5 年境界の前後・うるう年またぎ・同日を検証する。
  test('応当日の前日は満年数が 1 少ない（4 年）', () => {
    expect(holdingYears('2020-06-15', '2025-06-14')).toBe(4)
  })

  test('応当日当日は満年数に達する（5 年）', () => {
    expect(holdingYears('2020-06-15', '2025-06-15')).toBe(5)
  })

  test('2/29 取得を平年 2/28 に処分すると未満（4 年）', () => {
    expect(holdingYears('2020-02-29', '2025-02-28')).toBe(4)
  })

  test('2/29 取得を平年 3/1 に処分すると満了（5 年）', () => {
    expect(holdingYears('2020-02-29', '2025-03-01')).toBe(5)
  })

  test('同日取得・処分は 0 年', () => {
    expect(holdingYears('2023-06-30', '2023-06-30')).toBe(0)
  })
})