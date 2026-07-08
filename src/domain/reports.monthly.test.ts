import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { buildBreakdown, buildMonthly, buildMonthlyPL } from './reports';
import type { Account, JournalLine, LineSide } from '../db/types';

const TEST_ACCOUNTS: Account[] = [
  { code: '1130', year: 2026, name: '普通預金', category: 'asset', displayOrder: 130 },
  { code: '4110', year: 2026, name: '売上高', category: 'revenue', displayOrder: 110 },
  { code: '5020', year: 2026, name: '仕入', category: 'expense', displayOrder: 20 },
  { code: '5130', year: 2026, name: '水道光熱費', category: 'expense', displayOrder: 130 },
  { code: '5150', year: 2026, name: '通信費', category: 'expense', displayOrder: 150 },
];

async function addEntry(opts: {
  date: string;
  department?: string;
  lines: Array<{
    side: LineSide;
    accountCode: string;
    amount: string;
    vendorId?: string;
    subAccountId?: string;
  }>;
}): Promise<void> {
  const entryId = newId();
  const now = Date.now();
  await db.transaction('rw', db.journalEntries, db.journalLines, async () => {
    await db.journalEntries.add({
      id: entryId,
      date: opts.date,
      year: Number(opts.date.slice(0, 4)),
      description: 'テスト',
      ...(opts.department !== undefined ? { department: opts.department } : {}),
      status: 'confirmed',
      source: 'manual',
      createdAt: now,
      confirmedAt: now,
    });
    const lines: JournalLine[] = opts.lines.map((l) => ({
      id: newId(),
      entryId,
      side: l.side,
      accountCode: l.accountCode,
      ...(l.vendorId !== undefined ? { vendorId: l.vendorId } : {}),
      ...(l.subAccountId !== undefined ? { subAccountId: l.subAccountId } : {}),
      amount: l.amount,
      amountIndexed: toIndexable(l.amount),
      taxRate: 0,
      taxIncluded: false,
      invoiceCompliant: false,
    }));
    await db.journalLines.bulkAdd(lines);
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

describe('buildMonthlyPL', () => {
  test('科目別 × 月別マトリックスを生成', async () => {
    await addEntry({
      date: '2026-04-01',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '100000' },
        { side: 'credit', accountCode: '4110', amount: '100000' },
      ],
    });
    await addEntry({
      date: '2026-05-15',
      lines: [
        { side: 'debit', accountCode: '5130', amount: '5000' },
        { side: 'credit', accountCode: '1130', amount: '5000' },
      ],
    });
    await addEntry({
      date: '2026-05-20',
      lines: [
        { side: 'debit', accountCode: '5150', amount: '3000' },
        { side: 'credit', accountCode: '1130', amount: '3000' },
      ],
    });

    const r = await buildMonthlyPL(2026);
    expect(r.revenue).toHaveLength(1);
    expect(r.revenue[0]!.accountCode).toBe('4110');
    expect(r.revenue[0]!.monthly[3]).toBe('100000');  // 4月
    expect(r.revenue[0]!.total).toBe('100000');

    expect(r.expense).toHaveLength(2);
    expect(r.monthlyExpenseTotals[4]).toBe('8000');  // 5月
    expect(r.monthlyNetIncomes[3]).toBe('100000');
    expect(r.monthlyNetIncomes[4]).toBe('-8000');
    expect(r.netIncome).toBe('92000');
  });

  test('仕訳がない月は 0', async () => {
    const r = await buildMonthlyPL(2026);
    expect(r.monthlyRevenueTotals).toEqual(Array(12).fill('0'));
    expect(r.totalRevenue).toBe('0');
    expect(r.revenue).toEqual([]);
    expect(r.expense).toEqual([]);
  });

  test('同月の同科目は加算', async () => {
    await addEntry({
      date: '2026-06-01',
      lines: [
        { side: 'debit', accountCode: '5150', amount: '1000' },
        { side: 'credit', accountCode: '1130', amount: '1000' },
      ],
    });
    await addEntry({
      date: '2026-06-15',
      lines: [
        { side: 'debit', accountCode: '5150', amount: '2000' },
        { side: 'credit', accountCode: '1130', amount: '2000' },
      ],
    });
    const r = await buildMonthlyPL(2026);
    expect(r.expense[0]!.monthly[5]).toBe('3000');
  });
});

describe('buildMonthly（月別の仕入分離）', () => {
  test('仕入金額は仕入(5020)のみ。他の経費は仕入に混入しない', async () => {
    await addEntry({
      date: '2026-04-10',
      lines: [
        { side: 'debit', accountCode: '5020', amount: '30000' },
        { side: 'credit', accountCode: '1130', amount: '30000' },
      ],
    });
    await addEntry({
      date: '2026-04-20',
      lines: [
        { side: 'debit', accountCode: '5130', amount: '5000' },
        { side: 'credit', accountCode: '1130', amount: '5000' },
      ],
    });
    const r = await buildMonthly(2026);
    const apr = r.months[3]!; // 4月
    expect(apr.purchases).toBe('30000'); // 仕入のみ
    expect(apr.expense).toBe('35000'); // 経費合計は仕入+水道光熱費
  });

  test('仕入が無い月の仕入金額は 0', async () => {
    await addEntry({
      date: '2026-05-01',
      lines: [
        { side: 'debit', accountCode: '5150', amount: '3000' },
        { side: 'credit', accountCode: '1130', amount: '3000' },
      ],
    });
    const r = await buildMonthly(2026);
    expect(r.months[4]!.purchases).toBe('0'); // 5月は仕入なし
    expect(r.months[4]!.expense).toBe('3000');
  });
});

describe('buildBreakdown', () => {
  test('取引先別に集計（vendor）', async () => {
    await db.vendors.bulkAdd([
      { id: 'v1', name: 'AWS' },
      { id: 'v2', name: 'GCP' },
    ]);
    await addEntry({
      date: '2026-04-01',
      lines: [
        { side: 'debit', accountCode: '5150', amount: '10000', vendorId: 'v1' },
        { side: 'credit', accountCode: '1130', amount: '10000' },
      ],
    });
    await addEntry({
      date: '2026-05-01',
      lines: [
        { side: 'debit', accountCode: '5150', amount: '5000', vendorId: 'v2' },
        { side: 'credit', accountCode: '1130', amount: '5000' },
      ],
    });
    await addEntry({
      date: '2026-06-01',
      lines: [
        { side: 'debit', accountCode: '5150', amount: '3000', vendorId: 'v1' },
        { side: 'credit', accountCode: '1130', amount: '3000' },
      ],
    });

    const r = await buildBreakdown(2026, 'vendor');
    const g = r.groups.find((x) => x.accountCode === '5150');
    expect(g).toBeDefined();
    expect(g!.total).toBe('18000');
    expect(g!.entries).toHaveLength(2);
    // 金額降順
    expect(g!.entries[0]!.label).toBe('AWS');
    expect(g!.entries[0]!.amount).toBe('13000');
    expect(g!.entries[0]!.count).toBe(2);
    expect(g!.entries[1]!.label).toBe('GCP');
    expect(g!.entries[1]!.amount).toBe('5000');
  });

  test('取引先未指定は「未分類」', async () => {
    await addEntry({
      date: '2026-04-01',
      lines: [
        { side: 'debit', accountCode: '5150', amount: '1000' },
        { side: 'credit', accountCode: '1130', amount: '1000' },
      ],
    });
    const r = await buildBreakdown(2026, 'vendor');
    expect(r.groups[0]!.entries[0]!.label).toBe('（未分類）');
  });

  test('補助科目別（subAccount）', async () => {
    await db.subAccounts.bulkAdd([
      { id: 's1', accountCode: '1130', name: '三菱UFJ' },
      { id: 's2', accountCode: '1130', name: 'SBI' },
    ]);
    await addEntry({
      date: '2026-04-01',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '50000', subAccountId: 's1' },
        { side: 'credit', accountCode: '4110', amount: '50000' },
      ],
    });
    await addEntry({
      date: '2026-05-01',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '30000', subAccountId: 's2' },
        { side: 'credit', accountCode: '4110', amount: '30000' },
      ],
    });
    const r = await buildBreakdown(2026, 'subAccount');
    const g = r.groups.find((x) => x.accountCode === '1130');
    expect(g).toBeDefined();
    expect(g!.entries).toHaveLength(2);
    expect(g!.entries[0]!.label).toBe('三菱UFJ');
    expect(g!.entries[0]!.amount).toBe('50000');
  });

  test('部門別（department、分錄ではなく仕訳単位のタグ）', async () => {
    await addEntry({
      date: '2026-04-01',
      department: '東京店',
      lines: [
        { side: 'debit', accountCode: '5150', amount: '10000' },
        { side: 'credit', accountCode: '1130', amount: '10000' },
      ],
    });
    await addEntry({
      date: '2026-05-01',
      department: '大阪店',
      lines: [
        { side: 'debit', accountCode: '5150', amount: '5000' },
        { side: 'credit', accountCode: '1130', amount: '5000' },
      ],
    });
    await addEntry({
      date: '2026-06-01',
      lines: [
        { side: 'debit', accountCode: '5150', amount: '3000' },
        { side: 'credit', accountCode: '1130', amount: '3000' },
      ],
    });

    const r = await buildBreakdown(2026, 'department');
    const g = r.groups.find((x) => x.accountCode === '5150');
    expect(g).toBeDefined();
    expect(g!.total).toBe('18000');
    expect(g!.entries).toHaveLength(3);
    expect(g!.entries[0]!.label).toBe('東京店');
    expect(g!.entries[0]!.amount).toBe('10000');
    const unclassified = g!.entries.find((e) => e.key === '');
    expect(unclassified!.label).toBe('（未分類）');
    expect(unclassified!.amount).toBe('3000');
  });
});