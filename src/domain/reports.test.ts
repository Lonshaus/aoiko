import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { db } from '../db/db'
import { toIndexable } from '../lib/decimal'
import { newId } from '../lib/id'
import { buildAll, buildBS, buildMonthly, buildPL } from './reports'
import { reverseEntry } from './reverse'
import type { Account, JournalLine } from '../db/types'

const TEST_ACCOUNTS: Account[] = [
  { code: '1130', year: 2026, name: '普通預金', category: 'asset', displayOrder: 130 },
  { code: '4110', year: 2026, name: '売上高', category: 'revenue', displayOrder: 110 },
  { code: '5130', year: 2026, name: '水道光熱費', category: 'expense', displayOrder: 130 },
  { code: '5150', year: 2026, name: '通信費', category: 'expense', displayOrder: 150 },
]

async function addEntry(opts: {
  date: string
  description?: string
  lines: Array<{ side: 'debit' | 'credit'; accountCode: string; amount: string }>
}): Promise<string> {
  const entryId = newId()
  const now = Date.now()
  await db.transaction('rw', [db.journalEntries, db.journalLines], async () => {
    await db.journalEntries.add({
      id: entryId,
      date: opts.date,
      year: Number(opts.date.slice(0, 4)),
      description: opts.description ?? 'テスト',
      status: 'confirmed',
      source: 'manual',
      createdAt: now,
      confirmedAt: now,
    })
    const lines: JournalLine[] = opts.lines.map((l) => ({
      id: newId(),
      entryId,
      side: l.side,
      accountCode: l.accountCode,
      amount: l.amount,
      amountIndexed: toIndexable(l.amount),
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
    }))
    await db.journalLines.bulkAdd(lines)
  })
  return entryId
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  await db.accounts.bulkAdd(TEST_ACCOUNTS)
})

afterEach(async () => {
  await db.delete()
})

describe('buildPL', () => {
  test('aggregates revenue and expense across the year', async () => {
    await addEntry({
      date: '2026-04-15',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '100000' },
        { side: 'credit', accountCode: '4110', amount: '100000' },
      ],
    })
    await addEntry({
      date: '2026-05-10',
      lines: [
        { side: 'debit', accountCode: '5130', amount: '5000' },
        { side: 'credit', accountCode: '1130', amount: '5000' },
      ],
    })
    await addEntry({
      date: '2026-05-12',
      lines: [
        { side: 'debit', accountCode: '5150', amount: '3000' },
        { side: 'credit', accountCode: '1130', amount: '3000' },
      ],
    })

    const pl = await buildPL(2026)

    expect(pl.totalRevenue).toBe('100000')
    expect(pl.totalExpense).toBe('8000')
    expect(pl.netIncome).toBe('92000')
    expect(pl.entryCount).toBe(3)
    expect(pl.revenue).toHaveLength(1)
    expect(pl.expense).toHaveLength(2)
  })

  test('skips zero-amount accounts in result rows', async () => {
    await addEntry({
      date: '2026-04-15',
      lines: [
        { side: 'debit', accountCode: '5130', amount: '5000' },
        { side: 'credit', accountCode: '1130', amount: '5000' },
      ],
    })
    const pl = await buildPL(2026)
    expect(pl.expense.map((r) => r.accountCode)).toEqual(['5130'])
  })

  test('reversed original is excluded; reversal does not double-count', async () => {
    const id = await addEntry({
      date: '2026-04-15',
      lines: [
        { side: 'debit', accountCode: '5130', amount: '5000' },
        { side: 'credit', accountCode: '1130', amount: '5000' },
      ],
    })
    await reverseEntry(id)

    const pl = await buildPL(2026)
    expect(pl.totalExpense).toBe('0')
    expect(pl.expense).toHaveLength(0)
  })

  test('returns zeros when no entries', async () => {
    const pl = await buildPL(2026)
    expect(pl.totalRevenue).toBe('0')
    expect(pl.totalExpense).toBe('0')
    expect(pl.netIncome).toBe('0')
    expect(pl.entryCount).toBe(0)
  })

  test('売上値引（revenue 借方）は売上から控除される', async () => {
    await addEntry({
      date: '2026-04-15',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '50000' },
        { side: 'credit', accountCode: '4110', amount: '50000' },
      ],
    })
    // 値引 3,000：売上（借方）／普通預金（貸方）
    await addEntry({
      date: '2026-04-20',
      lines: [
        { side: 'debit', accountCode: '4110', amount: '3000' },
        { side: 'credit', accountCode: '1130', amount: '3000' },
      ],
    })

    const pl = await buildPL(2026)
    expect(pl.totalRevenue).toBe('47000')
    expect(pl.revenue.find((r) => r.accountCode === '4110')?.amount).toBe('47000')
  })

  test('経費の返金（expense 貸方）は経費から控除される', async () => {
    await addEntry({
      date: '2026-04-15',
      lines: [
        { side: 'debit', accountCode: '5130', amount: '5000' },
        { side: 'credit', accountCode: '1130', amount: '5000' },
      ],
    })
    // 返金 2,000：普通預金（借方）／水道光熱費（貸方）
    await addEntry({
      date: '2026-04-25',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '2000' },
        { side: 'credit', accountCode: '5130', amount: '2000' },
      ],
    })

    const pl = await buildPL(2026)
    expect(pl.totalExpense).toBe('3000')
    expect(pl.netIncome).toBe('-3000')
  })
})

describe('buildAll', () => {
  test('個別の buildX と同じ結果を返す（共有ロード）', async () => {
    await addEntry({
      date: '2026-04-15',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '50000' },
        { side: 'credit', accountCode: '4110', amount: '50000' },
      ],
    })
    await addEntry({
      date: '2026-05-20',
      lines: [
        { side: 'debit', accountCode: '5130', amount: '8000' },
        { side: 'credit', accountCode: '1130', amount: '8000' },
      ],
    })

    const all = await buildAll(2026, 'vendor')
    const [pl, bs, monthly] = [await buildPL(2026), await buildBS(2026), await buildMonthly(2026)]
    expect(all.pl).toEqual(pl)
    expect(all.bs).toEqual(bs)
    expect(all.monthly).toEqual(monthly)
    expect(all.breakdown.axis).toBe('vendor')
  })
})

describe('buildMonthly', () => {
  test('distributes sales across months', async () => {
    await addEntry({
      date: '2026-01-10',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '50000' },
        { side: 'credit', accountCode: '4110', amount: '50000' },
      ],
    })
    await addEntry({
      date: '2026-04-20',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '120000' },
        { side: 'credit', accountCode: '4110', amount: '120000' },
      ],
    })
    await addEntry({
      date: '2026-04-25',
      lines: [
        { side: 'debit', accountCode: '5130', amount: '5000' },
        { side: 'credit', accountCode: '1130', amount: '5000' },
      ],
    })

    const m = await buildMonthly(2026)
    expect(m.months).toHaveLength(12)
    expect(m.months[0]?.sales).toBe('50000')
    expect(m.months[3]?.sales).toBe('120000')
    expect(m.months[3]?.expense).toBe('5000')
    expect(m.months[1]?.sales).toBe('0')
    expect(m.totalSales).toBe('170000')
    expect(m.totalExpense).toBe('5000')
  })

  test('returns 12 zero months when no entries', async () => {
    const m = await buildMonthly(2026)
    expect(m.months).toHaveLength(12)
    expect(m.totalSales).toBe('0')
    expect(m.totalExpense).toBe('0')
    for (const month of m.months) {
      expect(month.sales).toBe('0')
      expect(month.expense).toBe('0')
    }
  })
})