import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { reverseEntry } from './reverse';
import { markYearFiled } from './snapshots';
import { todayISO } from '../lib/date';
import type { ReportSnapshotData } from '../db/types';

async function seedEntry(opts: {
  description: string;
  date: string;
  debitAccount: string;
  creditAccount: string;
  amount: string;
}): Promise<string> {
  const entryId = newId();
  const now = Date.now();
  await db.transaction('rw', [db.journalEntries, db.journalLines], async () => {
    await db.journalEntries.add({
      id: entryId,
      date: opts.date,
      year: Number(opts.date.slice(0, 4)),
      description: opts.description,
      status: 'confirmed',
      source: 'manual',
      createdAt: now,
      confirmedAt: now,
    });
    await db.journalLines.bulkAdd([
      {
        id: newId(),
        entryId,
        side: 'debit',
        accountCode: opts.debitAccount,
        amount: opts.amount,
        amountIndexed: toIndexable(opts.amount),
        taxRate: 0,
        taxIncluded: true,
        invoiceCompliant: false,
      },
      {
        id: newId(),
        entryId,
        side: 'credit',
        accountCode: opts.creditAccount,
        amount: opts.amount,
        amountIndexed: toIndexable(opts.amount),
        taxRate: 0,
        taxIncluded: true,
        invoiceCompliant: false,
      },
    ]);
  });
  return entryId;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('reverseEntry', () => {
  test('creates a reversal entry with swapped sides', async () => {
    const origId = await seedEntry({
      description: '電気代',
      date: '2026-04-15',
      debitAccount: '5130',
      creditAccount: '1130',
      amount: '5000',
    });

    const reversalId = await reverseEntry(origId);

    const reversal = await db.journalEntries.get(reversalId);
    expect(reversal).toBeDefined();
    expect(reversal!.originalEntryId).toBe(origId);
    expect(reversal!.description).toMatch(/^\[訂正\]/);
    expect(reversal!.status).toBe('confirmed');

    const reversalLines = await db.journalLines.where('entryId').equals(reversalId).toArray();
    expect(reversalLines).toHaveLength(2);

    const debit = reversalLines.find((l) => l.side === 'debit');
    const credit = reversalLines.find((l) => l.side === 'credit');
    expect(debit?.accountCode).toBe('1130');
    expect(credit?.accountCode).toBe('5130');
    expect(debit?.amount).toBe('5000');
    expect(credit?.amount).toBe('5000');
  });

  test('marks the original as reversed and links forward', async () => {
    const origId = await seedEntry({
      description: 'テスト',
      date: '2026-04-15',
      debitAccount: '5130',
      creditAccount: '1130',
      amount: '1000',
    });
    const reversalId = await reverseEntry(origId);

    const orig = await db.journalEntries.get(origId);
    expect(orig?.status).toBe('reversed');
    expect(orig?.reversedByEntryId).toBe(reversalId);
  });

  test('uses today as reversal date, not original', async () => {
    const origId = await seedEntry({
      description: 'テスト',
      date: '2025-01-01',
      debitAccount: '5130',
      creditAccount: '1130',
      amount: '1000',
    });
    const reversalId = await reverseEntry(origId);
    const reversal = await db.journalEntries.get(reversalId);
    // ローカル日付（UTC 変換だと JST 早朝に前日へずれる）
    expect(reversal?.date).toBe(todayISO());
    expect(reversal?.year).toBe(Number(todayISO().slice(0, 4)));
  });

  test('rejects already-reversed entry', async () => {
    const origId = await seedEntry({
      description: 'テスト',
      date: '2026-04-15',
      debitAccount: '5130',
      creditAccount: '1130',
      amount: '1000',
    });
    await reverseEntry(origId);

    await expect(reverseEntry(origId)).rejects.toThrow(/訂正済み/);
  });

  test('rejects nonexistent entry', async () => {
    await expect(reverseEntry('does-not-exist')).rejects.toThrow(/見つかりません/);
  });

  test('rejects reversing a correction entry (訂正の訂正は不可)', async () => {
    const origId = await seedEntry({
      description: 'テスト',
      date: '2026-04-15',
      debitAccount: '5130',
      creditAccount: '1130',
      amount: '1000',
    });
    const reversalId = await reverseEntry(origId);

    await expect(reverseEntry(reversalId)).rejects.toThrow(/訂正仕訳そのもの/);
  });

  test('rejects when entry year is locked (申告済み)', async () => {
    const origId = await seedEntry({
      description: 'テスト',
      date: '2026-04-15',
      debitAccount: '5130',
      creditAccount: '1130',
      amount: '1000',
    });
    const monthlySales: ReportSnapshotData & { type: 'monthly-sales' } = {
      type: 'monthly-sales',
      data: { months: [] },
    };
    const pl: ReportSnapshotData & { type: 'pl' } = {
      type: 'pl',
      data: {
        rows: [],
        totalRevenue: '0',
        totalExpense: '0',
        netIncome: '0',
      },
    };
    await markYearFiled(2026, { monthlySales, pl }, '2026-12-31');

    await expect(reverseEntry(origId)).rejects.toThrow(/申告済み.*ロック/);
  });

  test('rejects when the correction would land in a locked year (記帳先の年度ロック)', async () => {
    // 訂正仕訳は「今日」の年度に記帳される。原仕訳の年度が未ロックでも、
    // 今日の年度がロック済みなら訂正できない（申告済み年度への注入防止）
    const currentYear = Number(todayISO().slice(0, 4));
    const origId = await seedEntry({
      description: 'テスト',
      date: `${currentYear - 1}-04-15`,
      debitAccount: '5130',
      creditAccount: '1130',
      amount: '1000',
    });
    const monthlySales: ReportSnapshotData & { type: 'monthly-sales' } = {
      type: 'monthly-sales',
      data: { months: [] },
    };
    const pl: ReportSnapshotData & { type: 'pl' } = {
      type: 'pl',
      data: {
        rows: [],
        totalRevenue: '0',
        totalExpense: '0',
        netIncome: '0',
      },
    };
    await markYearFiled(currentYear, { monthlySales, pl }, `${currentYear}-12-31`);

    await expect(reverseEntry(origId)).rejects.toThrow(/記帳できません/);
  });
});
