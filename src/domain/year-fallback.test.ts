import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { D, toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { buildBS, buildPL } from './reports';
import { processYear } from './consumption-tax';
import { detectStaleCarryover } from './carryover';
import { exportGenericCsv } from './accountant-export';
import type { EntrySource, LineSide } from '../db/types';

interface LineSeed {
  side: LineSide;
  accountCode: string;
  amount: string;
  taxRate?: number;
}

async function seedEntry(opts: {
  date: string;
  pairs: LineSeed[];
  source?: EntrySource;
}): Promise<void> {
  const entryId = newId();
  const now = Date.now();
  await db.transaction('rw', db.journalEntries, db.journalLines, async () => {
    await db.journalEntries.add({
      id: entryId,
      date: opts.date,
      year: Number(opts.date.slice(0, 4)),
      description: 'テスト',
      status: 'confirmed',
      source: opts.source ?? 'manual',
      createdAt: now,
      confirmedAt: now,
    });
    await db.journalLines.bulkAdd(
      opts.pairs.map((p) => ({
        id: newId(),
        entryId,
        side: p.side,
        accountCode: p.accountCode,
        amount: p.amount,
        amountIndexed: toIndexable(p.amount),
        taxRate: p.taxRate ?? 0,
        taxIncluded: true,
        invoiceCompliant: false,
      })),
    );
  });
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.accounts.bulkAdd(ACCOUNTS_2026);
});

afterEach(async () => {
  await db.delete();
});

describe('科目が 2026 年度にしか無いとき、2027 年度の仕訳が略されない', () => {
  test('報表の売上と資産負債表に計上される', async () => {
    await seedEntry({
      date: '2027-03-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '300000' },
        { side: 'credit', accountCode: '4110', amount: '300000' },
      ],
    });
    const pl = await buildPL(2027);
    expect(pl.totalRevenue).toBe('300000');
    const bs = await buildBS(2027);
    expect(bs.assets.find((r) => r.accountCode === '1130')?.balance).toBe('300000');
  });

  test('消費税の課税標準に計上される', async () => {
    await seedEntry({
      date: '2027-03-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '1100000' },
        { side: 'credit', accountCode: '4110', amount: '1100000', taxRate: 0.1 },
      ],
    });
    const r = await processYear(2027);
    expect(r.taxableBase10.gt(D(0))).toBe(true);
  });

  test('繰越は 2027 年度の科目を読んで繰越仕訳の差異を検出する', async () => {
    await seedEntry({
      date: '2027-01-01',
      source: 'carryover',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '100000' },
        { side: 'credit', accountCode: '3110', amount: '100000' },
      ],
    });
    const stale = await detectStaleCarryover(2027);
    expect(stale).not.toBeNull();
    expect(stale?.differences.find((d) => d.accountCode === '1130')?.carried).toBe('100000');
  });

  test('会計士用の出力に勘定科目名つきで出力される', async () => {
    await seedEntry({
      date: '2027-03-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '300000' },
        { side: 'credit', accountCode: '4110', amount: '300000' },
      ],
    });
    const text = new TextDecoder().decode(await exportGenericCsv(2027));
    expect(text).toContain('売上高');
    expect(text).toContain('普通預金');
  });
});
