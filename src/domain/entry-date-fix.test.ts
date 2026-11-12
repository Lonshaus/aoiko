import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { db } from '../db/db';
import type { Account, JournalEntry, JournalLine, ReportSnapshotData } from '../db/types';
import { toIndexable } from '../lib/decimal';
import { m } from '../paraglide/messages';
import { checkStoredData } from './data-check';
import { correctEntryDate, listUnreadableDateEntries } from './entry-date-fix';
import { buildMonthly, buildPL } from './reports';
import { markYearFiled } from './snapshots';
import { FiledYearError } from './year-lock';

const ACCOUNTS: Account[] = [
  { code: '1110', year: 2026, name: '現金', category: 'asset', displayOrder: 110 },
  { code: '4110', year: 2026, name: '売上高', category: 'revenue', displayOrder: 410 },
];

function line(
  entryId: string,
  side: 'debit' | 'credit',
  accountCode: string,
  extras: Partial<JournalLine> = {},
): JournalLine {
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
    ...extras,
  };
}
// 型を外して書く。旧バージョンが保存した形（year が NaN や null）を再現するため。
async function seedEntry(opts: {
  id: string;
  date: string;
  year: unknown;
  status?: 'confirmed' | 'reversed';
  originalEntryId?: string;
  createdAt?: number;
  debitExtras?: Partial<JournalLine>;
}): Promise<void> {
  await db.table('journalEntries').put({
    id: opts.id,
    date: opts.date,
    year: opts.year,
    description: 'レシート',
    status: opts.status ?? 'confirmed',
    source: 'ocr',
    createdAt: opts.createdAt ?? 1,
    confirmedAt: opts.createdAt ?? 1,
    department: '本店',
    ...(opts.originalEntryId === undefined ? {} : { originalEntryId: opts.originalEntryId }),
  });
  await db.journalLines.bulkAdd([
    line(opts.id, 'debit', '1110', opts.debitExtras),
    line(opts.id, 'credit', '4110'),
  ]);
}

async function addAttachment(entryId: string): Promise<void> {
  await db.attachments.add({
    id: 'at1',
    entryId,
    blob: new NodeBlob([new Uint8Array([1, 2, 3])]) as unknown as Blob,
    mimeType: 'image/jpeg',
    fileName: 'receipt.jpg',
    createdAt: 1,
    sha256: 'd'.repeat(64),
  });
}

async function counts(): Promise<{ entries: number; lines: number; attachments: number }> {
  return {
    entries: await db.journalEntries.count(),
    lines: await db.journalLines.count(),
    attachments: await db.attachments.count(),
  };
}

async function reversalsOf(id: string): Promise<JournalEntry[]> {
  return db.journalEntries.where('originalEntryId').equals(id).toArray();
}

async function markFiled2026(): Promise<void> {
  const monthlySales: ReportSnapshotData & { type: 'monthly-sales' } = {
    type: 'monthly-sales',
    data: { months: [] },
  };
  const pl: ReportSnapshotData & { type: 'pl' } = {
    type: 'pl',
    data: { rows: [], totalRevenue: '0', totalExpense: '0', netIncome: '0' },
  };
  await markYearFiled(2026, { monthlySales, pl }, '2026-12-31');
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.accounts.bulkAdd(ACCOUNTS);
});

afterEach(async () => {
  await db.delete();
});

describe('listUnreadableDateEntries', () => {
  test('確定・原仕訳・日付が読めないものだけを、作成順に明細付きで返す', async () => {
    await seedEntry({ id: 'later', date: '2026/5/1', year: 2026, createdAt: 2 });
    await seedEntry({ id: 'earlier', date: '令和8年5月1日', year: NaN, createdAt: 1 });
    await seedEntry({ id: 'reversed', date: '2026/5/1', year: 2026, status: 'reversed' });
    await seedEntry({ id: 'readable', date: '2026-05-01', year: 2026 });
    await seedEntry({ id: 'reversal', date: '2026/5/1', year: 2026, originalEntryId: 'x' });

    const list = await listUnreadableDateEntries();
    expect(list.map((i) => i.entry.id)).toEqual(['earlier', 'later']);
    expect(list[0]?.lines.map((l) => l.accountCode).sort()).toEqual(['1110', '4110']);
    expect(list[0]?.attachmentCount).toBe(0);
  });
});

describe('correctEntryDate', () => {
  test('原仕訳を訂正仕訳で取り消し、正しい日付で同じ内容を登録し直す', async () => {
    await seedEntry({ id: 'o1', date: '2026/5/1', year: 2026 });
    const plBefore = await buildPL(2026);
    const monthlyBefore = await buildMonthly(2026);

    const { reversalId, newEntryId } = await correctEntryDate('o1', '2026-05-01');

    const orig = await db.journalEntries.get('o1');
    expect(orig?.status).toBe('reversed');
    expect(orig?.reversedByEntryId).toBe(reversalId);
    const reversals = await reversalsOf('o1');
    expect(reversals.map((e) => e.id)).toEqual([reversalId]);
    const fixed = await db.journalEntries.get(newEntryId);
    expect(fixed?.date).toBe('2026-05-01');
    expect(fixed?.year).toBe(2026);
    expect(fixed?.status).toBe('confirmed');
    expect(fixed?.description).toBe('レシート');
    expect(fixed?.department).toBe('本店');
    expect(fixed?.originalEntryId).toBeUndefined();
    const newLines = await db.journalLines.where('entryId').equals(newEntryId).toArray();
    expect(newLines.map((l) => [l.side, l.accountCode, l.amount]).sort()).toEqual([
      ['credit', '4110', '10000'],
      ['debit', '1110', '10000'],
    ]);

    expect((await buildPL(2026)).totalRevenue).toBe(plBefore.totalRevenue);
    expect(monthlyBefore.months[4]?.sales).toBe('0');
    expect((await buildMonthly(2026)).months[4]?.sales).toBe('10000');
  });

  test.each([
    { label: 'NaN', year: NaN },
    { label: 'null', year: null },
  ])('年度が $label の和暦の仕訳を直すと集計に入り、点検に出なくなる', async ({ year }) => {
    await seedEntry({ id: 'o1', date: '令和8年5月1日', year });
    const revenueBefore = (await buildPL(2026)).totalRevenue;
    expect((await checkStoredData()).total).toBe(1);

    await correctEntryDate('o1', '2026-05-01');

    expect(revenueBefore).toBe('0');
    expect((await buildPL(2026)).totalRevenue).toBe('10000');
    expect((await checkStoredData()).total).toBe(0);
  });

  test('証憑写真は新しい仕訳にも付け、元の仕訳の写真は残す', async () => {
    await seedEntry({ id: 'o1', date: '2026/5/1', year: 2026 });
    await addAttachment('o1');

    const { newEntryId } = await correctEntryDate('o1', '2026-05-01');

    const copied = await db.attachments.where('entryId').equals(newEntryId).toArray();
    expect(copied).toHaveLength(1);
    expect(copied[0]?.id).not.toBe('at1');
    expect(copied[0]?.sha256).toBe('d'.repeat(64));
    expect(copied[0]?.mimeType).toBe('image/jpeg');
    expect(copied[0]?.fileName).toBe('receipt.jpg');
    const bytes = new Uint8Array(await (copied[0]!.blob as unknown as NodeBlob).arrayBuffer());
    expect([...bytes]).toEqual([1, 2, 3]);
    expect((await db.attachments.get('at1'))?.entryId).toBe('o1');
  });

  test('明細の欄はすべて新しい仕訳の明細へ写す', async () => {
    const extras: Partial<JournalLine> = {
      subAccountId: 'sa1',
      vendorId: 'v1',
      homeOfficeRatio: '0.5',
      memo: 'メモ',
      taxCategory: 'taxable10',
      inputUsageCategory: 'common',
      itemId: 'it1',
      quantity: '2',
      taxableTransferConsideration: '1000',
    };
    await seedEntry({ id: 'o1', date: '2026/5/1', year: 2026, debitExtras: extras });

    const { newEntryId } = await correctEntryDate('o1', '2026-05-01');

    const original = await db.journalLines.get('o1-debit');
    const copied = (await db.journalLines.where('entryId').equals(newEntryId).toArray()).find(
      (l) => l.side === 'debit',
    );
    expect({ ...copied, id: original?.id, entryId: original?.entryId }).toEqual(original);
    expect(copied).toMatchObject(extras);
    expect(copied?.id).not.toBe('o1-debit');
    expect(copied?.entryId).toBe(newEntryId);
  });

  test('新しい仕訳の source は manual', async () => {
    await seedEntry({ id: 'o1', date: '2026/5/1', year: 2026 });
    const { newEntryId } = await correctEntryDate('o1', '2026-05-01');
    expect((await db.journalEntries.get(newEntryId))?.source).toBe('manual');
  });

  test('存在しない日付は拒み、何も書かない', async () => {
    await seedEntry({ id: 'o1', date: '2026/2/30', year: 2026 });
    const before = await counts();
    await expect(correctEntryDate('o1', '2026-02-30')).rejects.toThrow(
      m.entry_date_fix_error_date(),
    );
    expect(await counts()).toEqual(before);
  });

  test('申告済みの年度は確認で得た年度が無ければ拒み、あれば直す', async () => {
    await seedEntry({ id: 'o1', date: '2026/5/1', year: 2026 });
    await markFiled2026();
    const before = await counts();

    await expect(correctEntryDate('o1', '2026-05-01', { allowedFiledYears: [] })).rejects.toThrow(
      FiledYearError,
    );
    expect(await counts()).toEqual(before);
    expect((await db.journalEntries.get('o1'))?.status).toBe('confirmed');

    await correctEntryDate('o1', '2026-05-01', { allowedFiledYears: [2026] });
    expect((await db.journalEntries.get('o1'))?.status).toBe('reversed');
  });

  test('対象でない仕訳と YYYY-MM-DD でない新しい日付は拒み、何も書かない', async () => {
    await seedEntry({ id: 'readable', date: '2026-05-01', year: 2026 });
    await seedEntry({ id: 'reversed', date: '2026/5/1', year: 2026, status: 'reversed' });
    await seedEntry({ id: 'o1', date: '2026/5/1', year: 2026 });
    const before = await counts();

    await expect(correctEntryDate('readable', '2026-05-02')).rejects.toThrow(
      m.entry_date_fix_error_not_target(),
    );
    await expect(correctEntryDate('reversed', '2026-05-01')).rejects.toThrow(
      m.entry_date_fix_error_not_target(),
    );
    await expect(correctEntryDate('o1', '2026/05/01')).rejects.toThrow(
      m.entry_date_fix_error_date(),
    );
    expect(await counts()).toEqual(before);
    expect((await db.journalEntries.get('o1'))?.status).toBe('confirmed');
  });

  test('取引の途中で失敗したら、それまでの書き込みも残らない', async () => {
    await seedEntry({ id: 'o1', date: '2026/5/1', year: 2026 });
    await addAttachment('o1');
    const before = await counts();
    const fail = (): void => {
      throw new Error('attachment write failed');
    };
    db.attachments.hook('creating', fail);
    try {
      await expect(correctEntryDate('o1', '2026-05-01')).rejects.toThrow('attachment write failed');
    } finally {
      db.attachments.hook('creating').unsubscribe(fail);
    }

    expect((await db.journalEntries.get('o1'))?.status).toBe('confirmed');
    expect(await reversalsOf('o1')).toHaveLength(0);
    expect(await counts()).toEqual(before);
  });

  test('同じ仕訳を 2 回続けて直しても、登録し直すのは 1 回だけ', async () => {
    await seedEntry({ id: 'o1', date: '2026/5/1', year: 2026 });

    const results = await Promise.allSettled([
      correctEntryDate('o1', '2026-05-01'),
      correctEntryDate('o1', '2026-05-01'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toContain(
      m.entry_date_fix_error_not_target(),
    );
    expect(await reversalsOf('o1')).toHaveLength(1);
    const fixed = await db.journalEntries.where('date').equals('2026-05-01').toArray();
    expect(fixed).toHaveLength(1);
  });
});
