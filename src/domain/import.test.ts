import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { db } from '../db/db'
import {
  commitImport,
  computeFileHash,
  DuplicateImportError,
  findOverlappingRows,
  type ImportRow,
} from './import'
import { reverseEntry } from './reverse'
import type { ParsedTransaction } from '../parsers/types'

const KNOWN_INFO = {
  parserName: 'sbi-hybrid',
  fileName: 'sample.csv',
  knownAccountCode: '1130',
}

function tx(opts: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    date: '2026-05-01',
    description: 'テスト',
    amount: '1000',
    side: 'debit',
    rawRow: {},
    ...opts,
  }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

describe('computeFileHash', () => {
  test('returns 64 hex chars', async () => {
    const h = await computeFileHash('abc')
    expect(h).toHaveLength(64)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  test('same text → same hash', async () => {
    const a = await computeFileHash('hello')
    const b = await computeFileHash('hello')
    expect(a).toBe(b)
  })

  test('different text → different hash', async () => {
    const a = await computeFileHash('hello')
    const b = await computeFileHash('world')
    expect(a).not.toBe(b)
  })
})

describe('commitImport', () => {
  test('creates one entry with two lines per valid row', async () => {
    const rows: ImportRow[] = [
      {
        transaction: tx({ description: '入金', amount: '5000', side: 'debit' }),
        counterpartAccountCode: '4110',
      },
      {
        transaction: tx({
          description: '出金',
          amount: '3000',
          side: 'credit',
        }),
        counterpartAccountCode: '5130',
      },
    ]

    const result = await commitImport(
      { ...KNOWN_INFO, fileHash: 'hash-1' },
      rows
    )

    expect(result.entryCount).toBe(2)
    const entries = await db.journalEntries.toArray()
    const lines = await db.journalLines.toArray()
    expect(entries).toHaveLength(2)
    expect(lines).toHaveLength(4)

    const sourcedFromCsv = entries.every((e) => e.source === 'csv')
    expect(sourcedFromCsv).toBe(true)
  })

  test('debit transaction creates known=debit + counterpart=credit', async () => {
    const rows: ImportRow[] = [
      {
        transaction: tx({ amount: '5000', side: 'debit' }),
        counterpartAccountCode: '4110',
      },
    ]
    await commitImport({ ...KNOWN_INFO, fileHash: 'hash-debit' }, rows)

    const lines = await db.journalLines.toArray()
    const known = lines.find((l) => l.accountCode === '1130')
    const counter = lines.find((l) => l.accountCode === '4110')
    expect(known?.side).toBe('debit')
    expect(counter?.side).toBe('credit')
  })

  test('相手科目に税区分を設定でき、known 側は税率 0 のまま', async () => {
    const rows: ImportRow[] = [
      {
        transaction: tx({ amount: '5500', side: 'credit' }),
        counterpartAccountCode: '5130',
        counterpartTaxRate: 0.1,
        counterpartInvoiceCompliant: true,
      },
    ]
    await commitImport({ ...KNOWN_INFO, fileHash: 'hash-tax' }, rows)

    const lines = await db.journalLines.toArray()
    const known = lines.find((l) => l.accountCode === '1130')
    const counter = lines.find((l) => l.accountCode === '5130')
    // 決済側（普通預金）は非課税
    expect(known?.taxRate).toBe(0)
    // 費用側に消費税率・適格区分が乗る（本則課税の仕入税額控除の基礎）
    expect(counter?.taxRate).toBe(0.1)
    expect(counter?.invoiceCompliant).toBe(true)
  })

  test('税区分未指定なら従来どおり税率 0', async () => {
    const rows: ImportRow[] = [
      {
        transaction: tx({ amount: '1000', side: 'credit' }),
        counterpartAccountCode: '5130',
      },
    ]
    await commitImport({ ...KNOWN_INFO, fileHash: 'hash-notax' }, rows)
    const counter = (await db.journalLines.toArray()).find(
      (l) => l.accountCode === '5130'
    )
    expect(counter?.taxRate).toBe(0)
    expect(counter?.invoiceCompliant).toBe(false)
  })

  test('credit transaction creates known=credit + counterpart=debit', async () => {
    const rows: ImportRow[] = [
      {
        transaction: tx({ amount: '5000', side: 'credit' }),
        counterpartAccountCode: '5130',
      },
    ]
    await commitImport({ ...KNOWN_INFO, fileHash: 'hash-credit' }, rows)

    const lines = await db.journalLines.toArray()
    const known = lines.find((l) => l.accountCode === '1130')
    const counter = lines.find((l) => l.accountCode === '5130')
    expect(known?.side).toBe('credit')
    expect(counter?.side).toBe('debit')
  })

  test('skipped rows are excluded', async () => {
    const rows: ImportRow[] = [
      {
        transaction: tx({ description: 'これは入れる' }),
        counterpartAccountCode: '4110',
      },
      {
        transaction: tx({ description: 'これはスキップ' }),
        counterpartAccountCode: '4110',
        skip: true,
      },
    ]
    const result = await commitImport(
      { ...KNOWN_INFO, fileHash: 'hash-skip' },
      rows
    )

    expect(result.entryCount).toBe(1)
    const entries = await db.journalEntries.toArray()
    expect(entries[0]?.description).toBe('これは入れる')
  })

  test('rows missing counterpart are excluded', async () => {
    const rows: ImportRow[] = [
      {
        transaction: tx(),
        counterpartAccountCode: '',
      },
    ]
    await expect(
      commitImport({ ...KNOWN_INFO, fileHash: 'hash-empty' }, rows)
    ).rejects.toThrow(/登録対象/)
  })

  test('rejects duplicate fileHash', async () => {
    const rows: ImportRow[] = [
      { transaction: tx(), counterpartAccountCode: '4110' },
    ]
    await commitImport({ ...KNOWN_INFO, fileHash: 'shared-hash' }, rows)

    await expect(
      commitImport(
        { ...KNOWN_INFO, fileHash: 'shared-hash', fileName: 'second.csv' },
        rows
      )
    ).rejects.toThrow(DuplicateImportError)
  })

  test('description override takes precedence over parser description', async () => {
    const rows: ImportRow[] = [
      {
        transaction: tx({ description: 'パーサー由来' }),
        counterpartAccountCode: '4110',
        description: 'ユーザー上書き',
      },
    ]
    await commitImport({ ...KNOWN_INFO, fileHash: 'hash-override' }, rows)
    const e = (await db.journalEntries.toArray())[0]
    expect(e?.description).toBe('ユーザー上書き')
  })

  test('records ImportBatch with correct rowCount', async () => {
    const rows: ImportRow[] = [
      { transaction: tx(), counterpartAccountCode: '4110' },
      { transaction: tx(), counterpartAccountCode: '4110', skip: true },
      { transaction: tx(), counterpartAccountCode: '5130' },
    ]
    await commitImport({ ...KNOWN_INFO, fileHash: 'hash-batch' }, rows)

    const batches = await db.importBatches.toArray()
    expect(batches).toHaveLength(1)
    expect(batches[0]?.rowCount).toBe(2)
    expect(batches[0]?.parserName).toBe('sbi-hybrid')
  })

  test('all entries link back to ImportBatch via sourceImportId', async () => {
    const rows: ImportRow[] = [
      { transaction: tx(), counterpartAccountCode: '4110' },
      { transaction: tx(), counterpartAccountCode: '5130' },
    ]
    const result = await commitImport(
      { ...KNOWN_INFO, fileHash: 'hash-link' },
      rows
    )

    const entries = await db.journalEntries.toArray()
    for (const e of entries) {
      expect(e.sourceImportId).toBe(result.batchId)
    }
  })
})

describe('findOverlappingRows', () => {
  async function importBatch(fileHash: string, txs: ParsedTransaction[]): Promise<void> {
    await commitImport(
      { ...KNOWN_INFO, fileHash },
      txs.map((t) => ({ transaction: t, counterpartAccountCode: '5130' }))
    )
  }

  test('既存 CSV 仕訳と重なる行を候補にする', async () => {
    await importBatch('batch-1', [
      tx({ date: '2026-03-30', amount: '1000', side: 'credit' }),
      tx({ date: '2026-03-31', amount: '2000', side: 'credit' }),
    ])
    // 期間が重なる 2 件目のファイル：3/31 の行が重複
    const next = [
      tx({ date: '2026-03-31', amount: '2000', side: 'credit' }),
      tx({ date: '2026-04-01', amount: '3000', side: 'credit' }),
    ]
    const flagged = await findOverlappingRows(next, KNOWN_INFO.knownAccountCode)
    expect(flagged.has(0)).toBe(true)
    expect(flagged.has(1)).toBe(false)
  })

  test('同日同額が 2 件あり既存が 1 件なら 1 件だけ候補（多重集合）', async () => {
    await importBatch('batch-2', [tx({ date: '2026-05-01', amount: '500', side: 'credit' })])
    const next = [
      tx({ date: '2026-05-01', amount: '500', side: 'credit' }),
      tx({ date: '2026-05-01', amount: '500', side: 'credit' }),
    ]
    const flagged = await findOverlappingRows(next, KNOWN_INFO.knownAccountCode)
    expect(flagged.size).toBe(1)
  })

  test('既存仕訳が無ければ何も候補にしない', async () => {
    const flagged = await findOverlappingRows(
      [tx({ date: '2026-05-01', amount: '500', side: 'credit' })],
      KNOWN_INFO.knownAccountCode
    )
    expect(flagged.size).toBe(0)
  })

  test('訂正済み（reversed）の既存仕訳は突合対象外', async () => {
    await importBatch('batch-3', [tx({ date: '2026-06-01', amount: '700', side: 'credit' })])
    const entry = await db.journalEntries.filter((e) => e.source === 'csv').first()
    await reverseEntry(entry!.id)
    const flagged = await findOverlappingRows(
      [tx({ date: '2026-06-01', amount: '700', side: 'credit' })],
      KNOWN_INFO.knownAccountCode
    )
    expect(flagged.size).toBe(0)
  })
})