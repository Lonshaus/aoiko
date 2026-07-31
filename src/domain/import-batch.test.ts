import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { commitImport } from './import';
import { importBatchYears, reverseImportBatch } from './import-batch';
import { markYearFiled } from './snapshots';
import type { ParsedTransaction } from '../parsers/types';
import type { ReportSnapshotData } from '../db/types';

const monthlySales: ReportSnapshotData & { type: 'monthly-sales' } = {
  type: 'monthly-sales',
  data: { months: [] },
};
const pl: ReportSnapshotData & { type: 'pl' } = {
  type: 'pl',
  data: { rows: [], totalRevenue: '0', totalExpense: '0', netIncome: '0' },
};

const KNOWN = {
  parserName: 'sbi-hybrid',
  fileName: 'test.csv',
  fileHash: 'hash-1',
  knownAccountCode: '1130',
};

function tx(overrides: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    date: '2026-05-01',
    description: 'テスト',
    amount: '1000',
    side: 'debit',
    rawRow: {},
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

describe('reverseImportBatch', () => {
  test('reverses all entries from a batch', async () => {
    const result = await commitImport(KNOWN, [
      { transaction: tx({ description: 'a' }), counterpartAccountCode: '4110' },
      { transaction: tx({ description: 'b' }), counterpartAccountCode: '4110' },
      { transaction: tx({ description: 'c' }), counterpartAccountCode: '4110' },
    ]);

    const r = await reverseImportBatch(result.batchId);
    expect(r.reversedCount).toBe(3);
    expect(r.alreadyReversedCount).toBe(0);

    const reversedEntries = await db.journalEntries.where('status').equals('reversed').toArray();
    expect(reversedEntries).toHaveLength(3);
  });

  test('counts already-reversed entries separately', async () => {
    const result = await commitImport(KNOWN, [
      { transaction: tx(), counterpartAccountCode: '4110' },
      { transaction: tx(), counterpartAccountCode: '4110' },
    ]);
    // first invocation reverses both
    await reverseImportBatch(result.batchId);
    // second invocation should report 2 already-reversed
    const r = await reverseImportBatch(result.batchId);
    expect(r.reversedCount).toBe(0);
    expect(r.alreadyReversedCount).toBe(2);
  });

  test('原仕訳年度が申告済みだと既定では失敗する', async () => {
    const result = await commitImport(KNOWN, [
      { transaction: tx({ date: '2026-04-15' }), counterpartAccountCode: '4110' },
    ]);
    await markYearFiled(2026, { monthlySales, pl }, '2026-12-31');

    await expect(reverseImportBatch(result.batchId)).rejects.toThrow(/申告済み.*ロック/);
  });

  test('allowFiledYear:true なら申告済み年度でも成功する', async () => {
    const result = await commitImport(KNOWN, [
      { transaction: tx({ date: '2026-04-15' }), counterpartAccountCode: '4110' },
    ]);
    await markYearFiled(2026, { monthlySales, pl }, '2026-12-31');

    const r = await reverseImportBatch(result.batchId, { allowFiledYear: true });
    expect(r).toEqual({ reversedCount: 1, alreadyReversedCount: 0 });
  });
});

describe('importBatchYears', () => {
  test('重複を排除し昇順で返す', async () => {
    const result = await commitImport(KNOWN, [
      { transaction: tx({ date: '2026-04-15' }), counterpartAccountCode: '4110' },
      { transaction: tx({ date: '2025-04-15' }), counterpartAccountCode: '4110' },
      { transaction: tx({ date: '2026-05-01' }), counterpartAccountCode: '4110' },
    ]);

    expect(await importBatchYears(result.batchId)).toEqual([2025, 2026]);
  });
});
