import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { computeInventoryValuation } from './inventory';
import type { Account, JournalLine } from '../db/types';

const TEST_ACCOUNTS: Account[] = [
  { code: '1130', year: 2026, name: '普通預金', category: 'asset', displayOrder: 130 },
  { code: '4110', year: 2026, name: '売上高', category: 'revenue', displayOrder: 110 },
  { code: '5020', year: 2026, name: '仕入', category: 'expense', displayOrder: 20 },
];

async function addEntry(opts: {
  date: string;
  lines: Array<{
    side: 'debit' | 'credit';
    accountCode: string;
    amount: string;
    itemId?: string;
    quantity?: string;
  }>;
  status?: 'confirmed' | 'reversed';
  originalEntryId?: string;
}): Promise<string> {
  const entryId = newId();
  const now = Date.now();
  await db.transaction('rw', [db.journalEntries, db.journalLines], async () => {
    await db.journalEntries.add({
      id: entryId,
      date: opts.date,
      year: Number(opts.date.slice(0, 4)),
      description: 'テスト',
      status: opts.status ?? 'confirmed',
      source: 'manual',
      createdAt: now,
      confirmedAt: now,
      ...(opts.originalEntryId ? { originalEntryId: opts.originalEntryId } : {}),
    });
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
      ...(l.itemId ? { itemId: l.itemId } : {}),
      ...(l.quantity ? { quantity: l.quantity } : {}),
    }));
    await db.journalLines.bulkAdd(lines);
  });
  return entryId;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.accounts.bulkAdd(TEST_ACCOUNTS);
});

afterEach(async () => {
  await db.delete();
});

describe('computeInventoryValuation', () => {
  test('仕入で数量加算・直近単価を記録する', async () => {
    await addEntry({
      date: '2026-03-01',
      lines: [
        { side: 'debit', accountCode: '5020', amount: '10000', itemId: 'item-a', quantity: '10' },
        { side: 'credit', accountCode: '1130', amount: '10000' },
      ],
    });
    const result = await computeInventoryValuation('2026-12-31');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.quantity.toString()).toBe('10');
    expect(result.items[0]?.unitCost.toString()).toBe('1000');
    expect(result.totalValue.toString()).toBe('10000');
  });

  test('売上で数量を減算し、単価には影響しない', async () => {
    await addEntry({
      date: '2026-03-01',
      lines: [
        { side: 'debit', accountCode: '5020', amount: '10000', itemId: 'item-a', quantity: '10' },
        { side: 'credit', accountCode: '1130', amount: '10000' },
      ],
    });
    await addEntry({
      date: '2026-04-01',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '3000' },
        { side: 'credit', accountCode: '4110', amount: '3000', itemId: 'item-a', quantity: '3' },
      ],
    });
    const result = await computeInventoryValuation('2026-12-31');
    expect(result.items[0]?.quantity.toString()).toBe('7');
    expect(result.items[0]?.unitCost.toString()).toBe('1000');
    expect(result.totalValue.toString()).toBe('7000');
  });

  test('最終仕入原価法：直近の仕入単価を使う（過去の単価は無視）', async () => {
    await addEntry({
      date: '2026-01-01',
      lines: [
        { side: 'debit', accountCode: '5020', amount: '10000', itemId: 'item-a', quantity: '10' },
        { side: 'credit', accountCode: '1130', amount: '10000' },
      ],
    });
    await addEntry({
      date: '2026-06-01',
      lines: [
        { side: 'debit', accountCode: '5020', amount: '6600', itemId: 'item-a', quantity: '5' },
        { side: 'credit', accountCode: '1130', amount: '6600' },
      ],
    });
    const result = await computeInventoryValuation('2026-12-31');
    // 数量は累積 10+5=15、単価は直近仕入（6600/5=1320）を使う
    expect(result.items[0]?.quantity.toString()).toBe('15');
    expect(result.items[0]?.unitCost.toString()).toBe('1320');
    expect(result.totalValue.toString()).toBe('19800');
  });

  test('asOfDate より後の仕入は含めない', async () => {
    await addEntry({
      date: '2026-03-01',
      lines: [
        { side: 'debit', accountCode: '5020', amount: '10000', itemId: 'item-a', quantity: '10' },
        { side: 'credit', accountCode: '1130', amount: '10000' },
      ],
    });
    await addEntry({
      date: '2027-01-15',
      lines: [
        { side: 'debit', accountCode: '5020', amount: '5000', itemId: 'item-a', quantity: '5' },
        { side: 'credit', accountCode: '1130', amount: '5000' },
      ],
    });
    const result = await computeInventoryValuation('2026-12-31');
    expect(result.items[0]?.quantity.toString()).toBe('10');
  });

  test('itemId/quantity の無い行は無視する', async () => {
    await addEntry({
      date: '2026-03-01',
      lines: [
        { side: 'debit', accountCode: '5020', amount: '5000' },
        { side: 'credit', accountCode: '1130', amount: '5000' },
      ],
    });
    const result = await computeInventoryValuation('2026-12-31');
    expect(result.items).toHaveLength(0);
    expect(result.totalValue.toString()).toBe('0');
  });

  test('reversed（訂正済み原仕訳）は集計から除外する', async () => {
    const originalId = await addEntry({
      date: '2026-03-01',
      lines: [
        { side: 'debit', accountCode: '5020', amount: '10000', itemId: 'item-a', quantity: '10' },
        { side: 'credit', accountCode: '1130', amount: '10000' },
      ],
    });
    await db.journalEntries.update(originalId, { status: 'reversed' });
    await addEntry({
      date: '2026-03-02',
      originalEntryId: originalId,
      lines: [
        { side: 'credit', accountCode: '5020', amount: '10000', itemId: 'item-a', quantity: '10' },
        { side: 'debit', accountCode: '1130', amount: '10000' },
      ],
    });
    const result = await computeInventoryValuation('2026-12-31');
    expect(result.items).toHaveLength(0);
  });

  test('在庫がマイナスになった場合は評価額を0とする', async () => {
    await addEntry({
      date: '2026-03-01',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '3000' },
        { side: 'credit', accountCode: '4110', amount: '3000', itemId: 'item-a', quantity: '3' },
      ],
    });
    const result = await computeInventoryValuation('2026-12-31');
    expect(result.items[0]?.quantity.toString()).toBe('-3');
    expect(result.items[0]?.value.toString()).toBe('0');
  });
});
