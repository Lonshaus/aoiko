import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { readOpeningYears } from './business-opening';
import type { JournalEntry } from '../db/types';

function entry(
  id: string,
  date: string,
  year: number,
  extra: Partial<JournalEntry> = {},
): JournalEntry {
  return {
    id,
    date,
    year,
    description: '開業費計上（開業設定）',
    status: 'confirmed',
    source: 'opening',
    createdAt: 1,
    confirmedAt: 1,
    ...extra,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('readOpeningYears', () => {
  test('有効な開業仕訳の年を year の値で返し、日付が読めなくても数える。打ち消し済み・訂正仕訳・手入力は数えない', async () => {
    await db.journalEntries.bulkAdd([
      entry('a', '2026-07-01', 2026),
      entry('b', '2026-08-01', 2026),
      entry('bad', '2024-02-30', 2024),
      entry('rev', '2023-01-01', 2023, { status: 'reversed' }),
      entry('fix', '2022-01-01', 2022, { originalEntryId: 'x' }),
      entry('manual', '2021-01-01', 2021, { source: 'manual' }),
    ]);
    expect(await readOpeningYears()).toEqual([2024, 2026]);
  });
});
