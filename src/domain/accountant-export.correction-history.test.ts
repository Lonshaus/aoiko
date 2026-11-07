import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { db } from '../db/db';
import type { JournalLine } from '../db/types';
import { parseCsv } from '../lib/csv';
import { toIndexable } from '../lib/decimal';
import { exportCorrectionHistoryCsv } from './accountant-export';
import { correctEntryDate } from './entry-date-fix';
import { reverseEntry } from './reverse';

const HEADER = ['原仕訳日付', '原仕訳摘要', '原仕訳金額', '打消し仕訳日付'];

function line(entryId: string, side: 'debit' | 'credit', accountCode: string): JournalLine {
  return {
    id: `${entryId}-${side}`,
    entryId,
    side,
    accountCode,
    amount: '10000',
    amountIndexed: toIndexable('10000'),
    taxRate: 0.1,
    taxIncluded: true,
    invoiceCompliant: false,
  };
}
// 型を外して書く。旧バージョンが保存した形（year が NaN や null）を再現するため。
async function seedEntry(opts: {
  id: string;
  date: string;
  year: unknown;
  description?: string;
  status?: 'confirmed' | 'reversed';
  originalEntryId?: string;
  reversedByEntryId?: string;
  createdAt?: number;
}): Promise<void> {
  await db.table('journalEntries').put({
    id: opts.id,
    date: opts.date,
    year: opts.year,
    description: opts.description ?? 'レシート',
    status: opts.status ?? 'confirmed',
    source: 'manual',
    createdAt: opts.createdAt ?? 1,
    confirmedAt: opts.createdAt ?? 1,
    ...(opts.originalEntryId === undefined ? {} : { originalEntryId: opts.originalEntryId }),
    ...(opts.reversedByEntryId === undefined ? {} : { reversedByEntryId: opts.reversedByEntryId }),
  });
  await db.journalLines.bulkAdd([line(opts.id, 'debit', '1110'), line(opts.id, 'credit', '4110')]);
}

async function csvRows(year: number): Promise<string[][]> {
  const rows = parseCsv(new TextDecoder().decode(await exportCorrectionHistoryCsv(year)));
  expect(rows[0]).toEqual(HEADER);
  return rows.slice(1);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 2, 12, 0, 0));
  await db.delete();
  await db.open();
});

afterEach(async () => {
  vi.useRealTimers();
  await db.delete();
});

describe('exportCorrectionHistoryCsv', () => {
  test('前年の仕訳を今年訂正すると、前年の CSV に打消し仕訳の日付付きで載り、今年の CSV には載らない', async () => {
    await seedEntry({ id: 'o2025', date: '2025-06-10', year: 2025, description: '売上 6月' });

    await reverseEntry('o2025');

    expect(await csvRows(2025)).toEqual([['2025-06-10', '売上 6月', '10000', '2026-11-02']]);
    expect(await csvRows(2026)).toEqual([]);
  });

  test('年度が NaN の和暦の原仕訳は、日付を直した後に打消し仕訳の年度の CSV に載る', async () => {
    await seedEntry({ id: 'wareki', date: '令和8年5月1日', year: NaN });

    await correctEntryDate('wareki', '2026-05-01');

    expect(await csvRows(2026)).toEqual([['令和8年5月1日', 'レシート', '10000', '2026-11-02']]);
    expect(await csvRows(2025)).toEqual([]);
  });

  test.each([
    { label: '年度 0（日付が空）', date: '', year: 0 },
    { label: '年度 null', date: '令和8年5月1日', year: null },
  ])('$label の原仕訳も、日付を直した後に今年の CSV に一度だけ載る', async ({ date, year }) => {
    await seedEntry({ id: 'odd', date, year });

    await correctEntryDate('odd', '2026-05-01');

    expect(await csvRows(2026)).toEqual([[date, 'レシート', '10000', '2026-11-02']]);
    expect(await csvRows(2025)).toEqual([]);
  });

  test('同じ年度の中の訂正は、これまでどおり一行', async () => {
    await seedEntry({ id: 'o2026', date: '2026-03-01', year: 2026, description: '仕入 3月' });

    await reverseEntry('o2026');

    expect(await csvRows(2026)).toEqual([['2026-03-01', '仕入 3月', '10000', '2026-11-02']]);
  });

  test('訂正が無ければ見出し行だけ', async () => {
    await seedEntry({ id: 'plain', date: '2026-04-01', year: 2026 });

    expect(await csvRows(2026)).toEqual([]);
  });

  test('同じ年度にある原仕訳と打消し仕訳は一行だけで、処理年度の CSV には補われない', async () => {
    await seedEntry({
      id: 'o2018',
      date: '2018-12-31',
      year: 2018,
      description: '期首',
      status: 'reversed',
      reversedByEntryId: 'r2018',
    });
    await seedEntry({
      id: 'r2018',
      date: '2018-01-01',
      year: 2018,
      description: '[訂正] 期首',
      originalEntryId: 'o2018',
    });

    expect(await csvRows(2018)).toEqual([['2018-12-31', '期首', '10000', '2018-01-01']]);
    expect(await csvRows(2026)).toEqual([]);
  });

  test('一つの原仕訳を二つの打消し仕訳が指していても一行だけ', async () => {
    await seedEntry({
      id: 'n1',
      date: '令和8年5月1日',
      year: NaN,
      status: 'reversed',
      reversedByEntryId: 'ra',
    });
    await seedEntry({
      id: 'ra',
      date: '2026-11-02',
      year: 2026,
      originalEntryId: 'n1',
      createdAt: 10,
    });
    await seedEntry({
      id: 'rb',
      date: '2026-11-03',
      year: 2026,
      originalEntryId: 'n1',
      createdAt: 20,
    });

    expect(await csvRows(2026)).toEqual([['令和8年5月1日', 'レシート', '10000', '2026-11-02']]);
  });

  test('日付を引くために読んだ仕訳は行にならない', async () => {
    await seedEntry({
      id: 'a',
      date: '2025-04-01',
      year: 2025,
      description: 'A',
      status: 'reversed',
      reversedByEntryId: 'b',
    });
    await seedEntry({
      id: 'b',
      date: '2027-01-10',
      year: 2027,
      description: 'B',
      status: 'reversed',
      reversedByEntryId: 'x',
    });

    expect(await csvRows(2025)).toEqual([['2025-04-01', 'A', '10000', '']]);
  });

  test("原仕訳の摘要が = で始まるときは先頭に ' を付ける", async () => {
    await seedEntry({ id: 'f', date: '2026-03-01', year: 2026, description: '=1+1' });

    await reverseEntry('f');

    expect(await csvRows(2026)).toEqual([['2026-03-01', "'=1+1", '10000', '2026-11-02']]);
  });
});
