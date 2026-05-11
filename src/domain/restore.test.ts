import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { db } from '../db/db'
import { buildPayload, PAYLOAD_VERSION } from '../backup'
import { newId } from '../lib/id'
import { toIndexable } from '../lib/decimal'
import {
  IncompatibleBackupError,
  parseBackupJson,
  restoreFromJson,
} from './restore'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

describe('parseBackupJson', () => {
  test('throws on invalid JSON', () => {
    expect(() => parseBackupJson('{ not json')).toThrow(/JSON として/)
  })

  test('throws when missing required fields', () => {
    expect(() => parseBackupJson('{"foo":"bar"}')).toThrow(
      /バックアップ形式ではありません/
    )
  })

  test('returns object when valid', () => {
    const json = JSON.stringify({ version: 1, tables: {}, exportedAt: 'x' })
    expect(parseBackupJson(json).version).toBe(1)
  })
})

describe('restoreFromJson', () => {
  test('throws on incompatible version', async () => {
    await expect(
      restoreFromJson({ version: 999, exportedAt: '2026-05-10', tables: {} })
    ).rejects.toThrow(IncompatibleBackupError)
  })

  test('round-trips: export → restore yields identical state', async () => {
    const entryId = newId()
    const now = Date.now()
    await db.transaction(
      'rw',
      [db.journalEntries, db.journalLines, db.vendors],
      async () => {
        await db.journalEntries.add({
          id: entryId,
          date: '2026-05-01',
          year: 2026,
          description: '電気代',
          status: 'confirmed',
          source: 'manual',
          createdAt: now,
          confirmedAt: now,
        })
        await db.journalLines.bulkAdd([
          {
            id: newId(),
            entryId,
            side: 'debit',
            accountCode: '5130',
            amount: '5000',
            amountIndexed: toIndexable('5000'),
            taxRate: 0,
            taxIncluded: true,
            invoiceCompliant: false,
          },
          {
            id: newId(),
            entryId,
            side: 'credit',
            accountCode: '1130',
            amount: '5000',
            amountIndexed: toIndexable('5000'),
            taxRate: 0,
            taxIncluded: true,
            invoiceCompliant: false,
          },
        ])
        await db.vendors.add({ id: newId(), name: '東京電力' })
      }
    )

    const payload = await buildPayload()
    expect(payload.version).toBe(PAYLOAD_VERSION)

    const result = await restoreFromJson(payload)
    expect(result.tableCount).toBeGreaterThan(0)

    const entries = await db.journalEntries.toArray()
    const lines = await db.journalLines.toArray()
    const vendors = await db.vendors.toArray()
    expect(entries).toHaveLength(1)
    expect(lines).toHaveLength(2)
    expect(vendors).toHaveLength(1)
    expect(vendors[0]?.name).toBe('東京電力')
  })

  test('clears existing data before restore', async () => {
    await db.vendors.add({ id: newId(), name: '消える業者' })

    await restoreFromJson({
      version: PAYLOAD_VERSION,
      exportedAt: '2026-05-10',
      tables: { vendors: [{ id: 'new-1', name: '新業者' }] },
    })

    const vendors = await db.vendors.toArray()
    expect(vendors).toHaveLength(1)
    expect(vendors[0]?.name).toBe('新業者')
  })
})