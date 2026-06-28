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

  test('不正な payload では既存データを消さずに throw（検証は削除前）', async () => {
    await db.vendors.add({ id: 'keep-1', name: '残る業者' })

    await expect(
      restoreFromJson({
        version: PAYLOAD_VERSION,
        exportedAt: '2026-05-10',
        // 不正：side が不正な明細
        tables: { journalLines: [{ id: 'x', entryId: 'y', side: 'bogus', accountCode: '1', amount: '1', taxRate: 0 }] },
      })
    ).rejects.toThrow(/side/)

    const vendors = await db.vendors.toArray()
    expect(vendors).toHaveLength(1)
    expect(vendors[0]?.name).toBe('残る業者')
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

  test('申告者情報がバックアップに無ければ本機の値を保持する', async () => {
    const now = Date.now()
    await db.settings.bulkPut([
      { key: 'userRiyoshaId', value: '1234567890123456', updatedAt: now },
      { key: 'userFilerName', value: '青井 太郎', updatedAt: now },
    ])
    // 申告者情報を含まないバックアップ（既定の除外状態）を復元
    await restoreFromJson({
      version: PAYLOAD_VERSION,
      exportedAt: '2026-05-10',
      tables: { vendors: [{ id: 'v1', name: '業者' }] },
    })
    expect((await db.settings.get('userRiyoshaId'))?.value).toBe('1234567890123456')
    expect((await db.settings.get('userFilerName'))?.value).toBe('青井 太郎')
  })

  test('申告者情報がバックアップに含まれていればそれで上書きする', async () => {
    const now = Date.now()
    await db.settings.put({ key: 'userRiyoshaId', value: 'OLD', updatedAt: now })
    await restoreFromJson({
      version: PAYLOAD_VERSION,
      exportedAt: '2026-05-10',
      tables: {
        settings: [{ key: 'userRiyoshaId', value: 'NEW', updatedAt: now }],
      },
    })
    expect((await db.settings.get('userRiyoshaId'))?.value).toBe('NEW')
  })
})