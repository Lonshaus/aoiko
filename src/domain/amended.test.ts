import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { amendmentChecklist, getAmendmentDiff } from './amended';
import { markYearFiled, unlockYear } from './snapshots';
import type { Account, LineSide } from '../db/types';

const TEST_ACCOUNTS: Account[] = [
  { code: '1130', year: 2026, name: '普通預金', category: 'asset', displayOrder: 130 },
  { code: '4110', year: 2026, name: '売上高', category: 'revenue', displayOrder: 110 },
  { code: '5150', year: 2026, name: '通信費', category: 'expense', displayOrder: 150 },
];

async function addEntry(opts: {
  date: string;
  lines: Array<{ side: LineSide; accountCode: string; amount: string }>;
}): Promise<string> {
  const id = newId();
  const now = Date.now();
  await db.transaction('rw', db.journalEntries, db.journalLines, async () => {
    await db.journalEntries.add({
      id,
      date: opts.date,
      year: Number(opts.date.slice(0, 4)),
      description: 'テスト',
      status: 'confirmed',
      source: 'manual',
      createdAt: now,
      confirmedAt: now,
    });
    await db.journalLines.bulkAdd(
      opts.lines.map((l) => ({
        id: newId(),
        entryId: id,
        side: l.side,
        accountCode: l.accountCode,
        amount: l.amount,
        amountIndexed: toIndexable(l.amount),
        taxRate: 0,
        taxIncluded: false,
        invoiceCompliant: false,
      }))
    );
  });
  return id;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.accounts.bulkAdd(TEST_ACCOUNTS);
});

afterEach(async () => {
  await db.delete();
});

describe('getAmendmentDiff', () => {
  test('未申告なら null', async () => {
    const r = await getAmendmentDiff(2026);
    expect(r).toBeNull();
  });

  test('申告後に変更なしなら hasChange=false', async () => {
    await addEntry({
      date: '2026-04-01',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '100000' },
        { side: 'credit', accountCode: '4110', amount: '100000' },
      ],
    });
    await markYearFiled(
      2026,
      {
        monthlySales: { type: 'monthly-sales', data: { months: [] } },
        pl: {
          type: 'pl',
          data: {
            rows: [{ accountCode: '4110', amount: '100000' }],
            totalRevenue: '100000',
            totalExpense: '0',
            netIncome: '100000',
          },
        },
      },
      '2026-12-31'
    );
    const r = await getAmendmentDiff(2026);
    expect(r).not.toBeNull();
    expect(r!.hasChange).toBe(false);
    expect(r!.netIncomeDelta).toBe('0');
  });

  test('申告後に経費を追加すると hasChange=true・差額表示', async () => {
    await addEntry({
      date: '2026-04-01',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '100000' },
        { side: 'credit', accountCode: '4110', amount: '100000' },
      ],
    });
    await markYearFiled(
      2026,
      {
        monthlySales: { type: 'monthly-sales', data: { months: [] } },
        pl: {
          type: 'pl',
          data: {
            rows: [{ accountCode: '4110', amount: '100000' }],
            totalRevenue: '100000',
            totalExpense: '0',
            netIncome: '100000',
          },
        },
      },
      '2026-12-31'
    );
    // 漏れていた経費を追加
    await addEntry({
      date: '2026-05-01',
      lines: [
        { side: 'debit', accountCode: '5150', amount: '20000' },
        { side: 'credit', accountCode: '1130', amount: '20000' },
      ],
    });
    const r = await getAmendmentDiff(2026);
    expect(r!.hasChange).toBe(true);
    expect(r!.currentNetIncome).toBe('80000');
    expect(r!.netIncomeDelta).toBe('-20000');
    expect(r!.currentTotalExpense).toBe('20000');
  });

  test('ロック解除（unlockYear）後も当初申告との差分を計算できる', async () => {
    // 修正申告の手順は unlock → reverse → review。unlock 後も基準が残ることを確認する。
    await addEntry({
      date: '2026-04-01',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '100000' },
        { side: 'credit', accountCode: '4110', amount: '100000' },
      ],
    });
    await markYearFiled(
      2026,
      {
        monthlySales: { type: 'monthly-sales', data: { months: [] } },
        pl: {
          type: 'pl',
          data: {
            rows: [{ accountCode: '4110', amount: '100000' }],
            totalRevenue: '100000',
            totalExpense: '0',
            netIncome: '100000',
          },
        },
      },
      '2026-12-31'
    );
    await unlockYear(2026);
    // 解除後に経費を追加
    await addEntry({
      date: '2026-05-01',
      lines: [
        { side: 'debit', accountCode: '5150', amount: '20000' },
        { side: 'credit', accountCode: '1130', amount: '20000' },
      ],
    });
    const r = await getAmendmentDiff(2026);
    expect(r).not.toBeNull();
    expect(r!.filedNetIncome).toBe('100000');
    expect(r!.currentNetIncome).toBe('80000');
    expect(r!.netIncomeDelta).toBe('-20000');
  });
});

describe('amendmentChecklist', () => {
  test('5 ステップの key を順に返す', () => {
    const items = amendmentChecklist();
    expect(items.map((i) => i.key)).toEqual([
      'unlock',
      'reverse',
      'review',
      'submit',
      'relock',
    ]);
  });
});