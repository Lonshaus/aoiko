import { describe, expect, test } from 'vitest'
import { BackupValidationError, validateBackupPayload } from './restore-validate'
import type { BackupPayload } from '../backup'

function payload(tables: Record<string, unknown[]>): BackupPayload {
  return { version: 1, exportedAt: '2026-06-13T00:00:00.000Z', tables }
}

const validEntry = {
  id: 'e1',
  date: '2026-05-01',
  year: 2026,
  description: 'テスト',
  status: 'confirmed',
  source: 'manual',
  createdAt: 1,
  confirmedAt: 1,
}

const validLine = {
  id: 'l1',
  entryId: 'e1',
  side: 'debit',
  accountCode: '5130',
  amount: '5000',
  amountIndexed: '00000000005000.00',
  taxRate: 0,
  taxIncluded: true,
  invoiceCompliant: false,
}

describe('validateBackupPayload', () => {
  test('正常な payload は通る', () => {
    expect(() =>
      validateBackupPayload(
        payload({ journalEntries: [validEntry], journalLines: [validLine] })
      )
    ).not.toThrow()
  })

  test('空テーブルや未知テーブルは無視（破壊しない）', () => {
    expect(() =>
      validateBackupPayload(payload({ journalEntries: [], unknownTable: [{ x: 1 }] }))
    ).not.toThrow()
  })

  test('tables が配列でなければ投げる', () => {
    expect(() => validateBackupPayload(payload({ journalEntries: {} as never }))).toThrow(
      BackupValidationError
    )
  })

  test('仕訳の date が不正なら投げる', () => {
    expect(() =>
      validateBackupPayload(payload({ journalEntries: [{ ...validEntry, date: '2026/5/1' }] }))
    ).toThrow(/date/)
  })

  test('仕訳の status が不正なら投げる', () => {
    expect(() =>
      validateBackupPayload(payload({ journalEntries: [{ ...validEntry, status: 'draft' }] }))
    ).toThrow(/status/)
  })

  test('明細の side が不正なら投げる', () => {
    expect(() =>
      validateBackupPayload(payload({ journalLines: [{ ...validLine, side: 'left' }] }))
    ).toThrow(/side/)
  })

  test('明細の amount が数値文字列でなければ投げる', () => {
    expect(() =>
      validateBackupPayload(payload({ journalLines: [{ ...validLine, amount: 'abc' }] }))
    ).toThrow(/amount/)
    // number は文字列ではないので拒否（Dexie 境界では string のはず）
    expect(() =>
      validateBackupPayload(payload({ journalLines: [{ ...validLine, amount: 5000 }] }))
    ).toThrow(/amount/)
  })

  test('明細がオブジェクトでなければ投げる', () => {
    expect(() =>
      validateBackupPayload(payload({ journalLines: ['not-an-object'] }))
    ).toThrow(BackupValidationError)
  })

  test('その他テーブルは主キー欠落で投げる', () => {
    expect(() => validateBackupPayload(payload({ vendors: [{ name: '主キー無し' }] }))).toThrow(
      /vendors/
    )
    expect(() => validateBackupPayload(payload({ settings: [{ value: 1 }] }))).toThrow(/settings/)
  })

  test('その他テーブルは主キーがあれば通る', () => {
    expect(() =>
      validateBackupPayload(payload({ vendors: [{ id: 'v1', name: 'X' }], settings: [{ key: 'k', value: 1 }] }))
    ).not.toThrow()
  })
})