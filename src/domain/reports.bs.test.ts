import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { newId } from '../lib/id';
import { toIndexable } from '../lib/decimal';
import { buildBS } from './reports';
import { reverseEntry } from './reverse';
import type { Account, JournalLine } from '../db/types';

const TEST_ACCOUNTS: Account[] = [
  { code: '1110', year: 2026, name: '現金', category: 'asset', displayOrder: 110 },
  { code: '1130', year: 2026, name: '普通預金', category: 'asset', displayOrder: 130 },
  { code: '2120', year: 2026, name: '未払金', category: 'liability', displayOrder: 120 },
  { code: '3110', year: 2026, name: '元入金', category: 'equity', displayOrder: 110 },
  { code: '4110', year: 2026, name: '売上高', category: 'revenue', displayOrder: 110 },
  { code: '5130', year: 2026, name: '水道光熱費', category: 'expense', displayOrder: 130 },
];

async function addEntry(opts: {
  date: string;
  lines: Array<{ side: 'debit' | 'credit'; accountCode: string; amount: string }>;
}): Promise<string> {
  const entryId = newId();
  const now = Date.now();
  await db.transaction('rw', [db.journalEntries, db.journalLines], async () => {
    await db.journalEntries.add({
      id: entryId,
      date: opts.date,
      year: Number(opts.date.slice(0, 4)),
      description: 'テスト',
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
      amount: l.amount,
      amountIndexed: toIndexable(l.amount),
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
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

describe('buildBS', () => {
  test('開業時：元入金 100,000 を普通預金として入金', async () => {
    await addEntry({
      date: '2026-01-01',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '100000' },
        { side: 'credit', accountCode: '3110', amount: '100000' },
      ],
    });

    const bs = await buildBS(2026);
    expect(bs.assets).toHaveLength(1);
    expect(bs.assets[0]?.accountCode).toBe('1130');
    expect(bs.assets[0]?.balance).toBe('100000');
    expect(bs.equity).toHaveLength(1);
    expect(bs.equity[0]?.accountCode).toBe('3110');
    expect(bs.equity[0]?.balance).toBe('100000');
    expect(bs.totalAssets).toBe('100000');
    expect(bs.totalLiabilitiesAndEquity).toBe('100000');
    expect(bs.balanced).toBe(true);
  });

  test('当期純利益が純資産に算入されてバランスする', async () => {
    // 入金：売上 50,000
    await addEntry({
      date: '2026-04-15',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '50000' },
        { side: 'credit', accountCode: '4110', amount: '50000' },
      ],
    });
    // 経費：電気代 5,000
    await addEntry({
      date: '2026-04-20',
      lines: [
        { side: 'debit', accountCode: '5130', amount: '5000' },
        { side: 'credit', accountCode: '1130', amount: '5000' },
      ],
    });

    const bs = await buildBS(2026);
    expect(bs.netIncome).toBe('45000'); // 50000 - 5000
    expect(bs.assets[0]?.balance).toBe('45000'); // 普通預金 50000-5000
    expect(bs.totalAssets).toBe('45000');
    expect(bs.totalLiabilitiesAndEquity).toBe('45000'); // 純資産＝純利益 45000
    expect(bs.balanced).toBe(true);
  });

  test('未払金（負債）の残高', async () => {
    await addEntry({
      date: '2026-04-15',
      lines: [
        { side: 'debit', accountCode: '5130', amount: '3000' },
        { side: 'credit', accountCode: '2120', amount: '3000' },
      ],
    });

    const bs = await buildBS(2026);
    expect(bs.liabilities).toHaveLength(1);
    expect(bs.liabilities[0]?.balance).toBe('3000');
    expect(bs.balanced).toBe(true);
  });

  test('対象年度を超える仕訳は集計外', async () => {
    await addEntry({
      date: '2027-01-15',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '100000' },
        { side: 'credit', accountCode: '3110', amount: '100000' },
      ],
    });

    const bs = await buildBS(2026);
    expect(bs.assets).toHaveLength(0);
  });

  test('訂正仕訳（reverseEntry）後も B/S はバランスし、幻の残高が出ない', async () => {
    // 売上 50,000
    await addEntry({
      date: '2026-04-15',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '50000' },
        { side: 'credit', accountCode: '4110', amount: '50000' },
      ],
    });
    // 経費 5,000 → 誤記として訂正
    const wrongId = await addEntry({
      date: '2026-04-20',
      lines: [
        { side: 'debit', accountCode: '5130', amount: '5000' },
        { side: 'credit', accountCode: '1130', amount: '5000' },
      ],
    });
    await reverseEntry(wrongId);

    const bs = await buildBS(2026);
    // 訂正ペアは正味ゼロ：経費 5,000 がなかったのと同じ状態に戻る
    expect(bs.assets[0]?.balance).toBe('50000');
    expect(bs.netIncome).toBe('50000');
    expect(bs.totalAssets).toBe('50000');
    expect(bs.totalLiabilitiesAndEquity).toBe('50000');
    expect(bs.balanced).toBe(true);
  });

  test('残高ゼロの科目は出力に含まれない', async () => {
    await addEntry({
      date: '2026-04-15',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '100' },
        { side: 'credit', accountCode: '1110', amount: '100' },
      ],
    });
    await addEntry({
      date: '2026-04-16',
      lines: [
        { side: 'debit', accountCode: '1110', amount: '100' },
        { side: 'credit', accountCode: '1130', amount: '100' },
      ],
    });

    const bs = await buildBS(2026);
    expect(bs.assets).toHaveLength(0);
  });
});
