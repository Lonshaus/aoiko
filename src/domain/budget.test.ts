import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { newId } from '../lib/id';
import { toIndexable } from '../lib/decimal';
import { computeBudgetVsActual, getBudgets, setBudget } from './budget';
import type { Account } from '../db/types';

const TEST_ACCOUNTS: Account[] = [
  { code: '1130', year: 2026, name: '普通預金', category: 'asset', displayOrder: 130 },
  { code: '4110', year: 2026, name: '売上高', category: 'revenue', displayOrder: 110 },
  { code: '5150', year: 2026, name: '通信費', category: 'expense', displayOrder: 150 },
];

async function addEntry(
  date: string,
  lines: Array<{ side: 'debit' | 'credit'; accountCode: string; amount: string }>,
): Promise<void> {
  const entryId = newId();
  const now = Date.now();
  await db.transaction('rw', [db.journalEntries, db.journalLines], async () => {
    await db.journalEntries.add({
      id: entryId,
      date,
      year: Number(date.slice(0, 4)),
      description: 'テスト',
      status: 'confirmed',
      source: 'manual',
      createdAt: now,
      confirmedAt: now,
    });
    await db.journalLines.bulkAdd(
      lines.map((l) => ({
        id: newId(),
        entryId,
        side: l.side,
        accountCode: l.accountCode,
        amount: l.amount,
        amountIndexed: toIndexable(l.amount),
        taxRate: 0,
        taxIncluded: true,
        invoiceCompliant: false,
      })),
    );
  });
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.accounts.bulkAdd(TEST_ACCOUNTS);
});

afterEach(async () => {
  await db.delete();
});

describe('setBudget / getBudgets', () => {
  test('年月ごとに予算を保存・取得できる', async () => {
    await setBudget({ year: 2026, month: 4, revenueBudget: '100000', expenseBudget: '30000' });
    await setBudget({ year: 2026, month: 5, revenueBudget: '120000', expenseBudget: '40000' });
    const rows = await getBudgets(2026);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.month).toBe(4);
    expect(rows[1]!.month).toBe(5);
  });

  test('同じ年月に再度 setBudget すると上書きされる', async () => {
    await setBudget({ year: 2026, month: 4, revenueBudget: '100000', expenseBudget: '30000' });
    await setBudget({ year: 2026, month: 4, revenueBudget: '200000', expenseBudget: '50000' });
    const rows = await getBudgets(2026);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revenueBudget).toBe('200000');
  });
});

describe('computeBudgetVsActual', () => {
  test('予算と実績の差異を月別に算出する', async () => {
    await setBudget({ year: 2026, month: 4, revenueBudget: '100000', expenseBudget: '3000' });
    await addEntry('2026-04-15', [
      { side: 'debit', accountCode: '1130', amount: '120000' },
      { side: 'credit', accountCode: '4110', amount: '120000' },
    ]);
    await addEntry('2026-04-20', [
      { side: 'debit', accountCode: '5150', amount: '5000' },
      { side: 'credit', accountCode: '1130', amount: '5000' },
    ]);

    const r = await computeBudgetVsActual(2026);
    expect(r.months).toHaveLength(12);
    const april = r.months[3]!;
    expect(april.revenueBudget).toBe('100000');
    expect(april.revenueActual).toBe('120000');
    expect(april.revenueDiff).toBe('20000');
    expect(april.expenseBudget).toBe('3000');
    expect(april.expenseActual).toBe('5000');
    expect(april.expenseDiff).toBe('2000');
  });

  test('予算未設定の月は 0 予算として扱う', async () => {
    const r = await computeBudgetVsActual(2026);
    const jan = r.months[0]!;
    expect(jan.revenueBudget).toBe('0');
    expect(jan.expenseBudget).toBe('0');
    expect(jan.revenueDiff).toBe('0');
  });
});
