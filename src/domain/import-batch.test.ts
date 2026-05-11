import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { db } from '../db/db'
import { commitImport } from './import'
import { reverseImportBatch } from './import-batch'
import type { ParsedTransaction } from '../parsers/types'

const KNOWN = {
  parserName: 'sbi-hybrid',
  fileName: 'test.csv',
  fileHash: 'hash-1',
  knownAccountCode: '1130',
}

function tx(overrides: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    date: '2026-05-01',
    description: 'テスト',
    amount: '1000',
    side: 'debit',
    rawRow: {},
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

describe('reverseImportBatch', () => {
  test('reverses all entries from a batch', async () => {
    const result = await commitImport(KNOWN, [
      { transaction: tx({ description: 'a' }), counterpartAccountCode: '4110' },
      { transaction: tx({ description: 'b' }), counterpartAccountCode: '4110' },
      { transaction: tx({ description: 'c' }), counterpartAccountCode: '4110' },
    ])

    const r = await reverseImportBatch(result.batchId)
    expect(r.reversedCount).toBe(3)
    expect(r.alreadyReversedCount).toBe(0)

    const reversedEntries = await db.journalEntries
      .where('status')
      .equals('reversed')
      .toArray()
    expect(reversedEntries).toHaveLength(3)
  })

  test('counts already-reversed entries separately', async () => {
    const result = await commitImport(KNOWN, [
      { transaction: tx(), counterpartAccountCode: '4110' },
      { transaction: tx(), counterpartAccountCode: '4110' },
    ])

    // first invocation reverses both
    await reverseImportBatch(result.batchId)
    // second invocation should report 2 already-reversed
    const r = await reverseImportBatch(result.batchId)
    expect(r.reversedCount).toBe(0)
    expect(r.alreadyReversedCount).toBe(2)
  })
})