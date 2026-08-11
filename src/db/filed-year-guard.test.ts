// 門は「domain 関数を通ったか」ではなく「書き込みそのもの」を見る。ここで確かめるのは、
// 入口を経由しない直接の書き込みが止まること（#418）と、確認を通った経路が通ること。
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { markYearFiled, unlockYear } from '../domain/snapshots';
import { db } from './db';
import {
  allowFiledYearWriteInThisTransaction,
  FiledYearError,
  filedYearsSnapshot,
} from './filed-year-guard';
import type { JournalEntry, ReportSnapshotData } from './types';

const FILED = 2026;
const monthlySales: ReportSnapshotData & { type: 'monthly-sales' } = {
  type: 'monthly-sales',
  data: { months: [] },
};
const pl: ReportSnapshotData & { type: 'pl' } = {
  type: 'pl',
  data: { rows: [], totalRevenue: '0', totalExpense: '0', netIncome: '0' },
};

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: `e-${Math.random().toString(36).slice(2)}`,
    date: `${FILED}-05-01`,
    year: FILED,
    description: 'テスト',
    status: 'confirmed',
    source: 'manual',
    createdAt: 0,
    ...overrides,
  } as JournalEntry;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('申告済み年度への直接の書き込み', () => {
  test('domain 関数を通らない add でも止まる（画面から直に書く経路）', async () => {
    await markYearFiled(FILED, { monthlySales, pl }, `${FILED}-12-31`);
    await expect(db.journalEntries.add(entry())).rejects.toThrow(FiledYearError);
    expect(await db.journalEntries.count()).toBe(0);
  });

  test('bulkAdd でも止まる。1 件でも申告済みなら全体が通らない', async () => {
    await markYearFiled(FILED, { monthlySales, pl }, `${FILED}-12-31`);
    await expect(
      db.journalEntries.bulkAdd([entry({ year: FILED - 1, date: `${FILED - 1}-05-01` }), entry()]),
    ).rejects.toThrow(FiledYearError);
    expect(await db.journalEntries.count()).toBe(0);
  });

  test('未申告の年度は素通りする', async () => {
    await markYearFiled(FILED, { monthlySales, pl }, `${FILED}-12-31`);
    await db.journalEntries.add(entry({ year: FILED - 1, date: `${FILED - 1}-05-01` }));
    expect(await db.journalEntries.count()).toBe(1);
  });
  // 訂正仕訳は originalEntryId を持ち countsTowardTotals から外れる。申告済み年度へ
  // 入っても数字は動かないので、止めると訂正そのものができなくなる。
  test('集計に入らない仕訳は申告済み年度でも書ける', async () => {
    await markYearFiled(FILED, { monthlySales, pl }, `${FILED}-12-31`);
    await db.journalEntries.add(entry({ originalEntryId: 'orig-1' }));
    await db.journalEntries.add(entry({ status: 'reversed' }));
    expect(await db.journalEntries.count()).toBe(2);
  });

  test('印を付けた取引は通る', async () => {
    await markYearFiled(FILED, { monthlySales, pl }, `${FILED}-12-31`);
    await db.transaction('rw', db.journalEntries, async () => {
      allowFiledYearWriteInThisTransaction();
      await db.journalEntries.add(entry());
    });
    expect(await db.journalEntries.count()).toBe(1);
  });
  // 印は取引に付く。全域の旗にすると、確認したのとは別の書き込みまで通ってしまう。
  test('印は次の取引へ持ち越されない', async () => {
    await markYearFiled(FILED, { monthlySales, pl }, `${FILED}-12-31`);
    await db.transaction('rw', db.journalEntries, async () => {
      allowFiledYearWriteInThisTransaction();
      await db.journalEntries.add(entry());
    });
    await expect(db.journalEntries.add(entry())).rejects.toThrow(FiledYearError);
    expect(await db.journalEntries.count()).toBe(1);
  });
});

describe('申告済み年度の記憶', () => {
  test('申告した直後の書き込みが古い記憶で素通りしない', async () => {
    await db.journalEntries.add(entry());
    expect(filedYearsSnapshot()).toEqual([]);
    await markYearFiled(FILED, { monthlySales, pl }, `${FILED}-12-31`);
    expect(filedYearsSnapshot()).toEqual([FILED]);
    await expect(db.journalEntries.add(entry())).rejects.toThrow(FiledYearError);
  });

  test('ロックを解除したら書けるようになる', async () => {
    await markYearFiled(FILED, { monthlySales, pl }, `${FILED}-12-31`);
    await expect(db.journalEntries.add(entry())).rejects.toThrow(FiledYearError);
    await unlockYear(FILED);
    expect(filedYearsSnapshot()).toEqual([]);
    await db.journalEntries.add(entry());
    expect(await db.journalEntries.count()).toBe(1);
  });
  // Dexie の ready は既定で一度きり。sticky を外すと、開き直しても記憶が読み直されず
  // 前のデータベースの年度が残る。
  test('開き直すと記憶も張り直される', async () => {
    await markYearFiled(FILED, { monthlySales, pl }, `${FILED}-12-31`);
    expect(filedYearsSnapshot()).toEqual([FILED]);
    await db.delete();
    await db.open();
    expect(filedYearsSnapshot()).toEqual([]);
    await db.journalEntries.add(entry());
    expect(await db.journalEntries.count()).toBe(1);
  });
});
