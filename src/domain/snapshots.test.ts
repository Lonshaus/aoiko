import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { db } from '../db/db'
import { isYearLocked, markYearFiled, unlockYear } from './snapshots'
import type { ReportSnapshotData } from '../db/types'

const monthlySales: ReportSnapshotData & { type: 'monthly-sales' } = {
  type: 'monthly-sales',
  data: { months: [] },
}
const pl: ReportSnapshotData & { type: 'pl' } = {
  type: 'pl',
  data: { rows: [], totalRevenue: '0', totalExpense: '0', netIncome: '0' },
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

describe('markYearFiled', () => {
  test('writes monthly-sales + pl snapshots', async () => {
    await markYearFiled(2026, { monthlySales, pl }, '2026-12-31')
    const all = await db.reportSnapshots.toArray()
    expect(all).toHaveLength(2)
    expect(all.every((s) => s.status === 'filed')).toBe(true)
    expect(all.every((s) => s.year === 2026)).toBe(true)
  })

  test('includes BS when provided', async () => {
    const bs: ReportSnapshotData & { type: 'bs' } = {
      type: 'bs',
      data: { assets: [], liabilities: [], equity: [] },
    }
    await markYearFiled(2026, { monthlySales, pl, bs }, '2026-12-31')
    const all = await db.reportSnapshots.toArray()
    expect(all).toHaveLength(3)
  })
})

describe('isYearLocked', () => {
  test('returns false when no snapshot filed', async () => {
    expect(await isYearLocked(2026)).toBe(false)
  })

  test('returns true after markYearFiled', async () => {
    await markYearFiled(2026, { monthlySales, pl }, '2026-12-31')
    expect(await isYearLocked(2026)).toBe(true)
    expect(await isYearLocked(2025)).toBe(false)
  })
})

describe('unlockYear', () => {
  test('removes filed snapshots', async () => {
    await markYearFiled(2026, { monthlySales, pl }, '2026-12-31')
    const r = await unlockYear(2026)
    expect(r.removed).toBe(2)
    expect(await isYearLocked(2026)).toBe(false)
  })
})