import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { toIndexable } from '../lib/decimal';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { processYear } from './consumption-tax';
import { buildYayoiCsvRows, exportYayoiCsv } from './accountant-export';
import { findOversizedAmounts } from './oversized-amounts';
import { m } from '../paraglide/messages';
import type { Account } from '../db/types';

async function seedSale(consideration: string): Promise<void> {
  await db.journalEntries.add({
    id: 'e1',
    date: '2026-05-01',
    year: 2026,
    description: '固定資産売却 車',
    status: 'confirmed',
    source: 'manual',
    createdAt: 1,
    confirmedAt: 1,
  });
  await db.journalLines.bulkAdd([
    {
      id: 'l1',
      entryId: 'e1',
      side: 'debit',
      accountCode: '1110',
      amount: '1000',
      amountIndexed: toIndexable('1000'),
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
    },
    {
      id: 'l2',
      entryId: 'e1',
      side: 'credit',
      accountCode: '1514',
      amount: '1000',
      amountIndexed: toIndexable('1000'),
      taxRate: 0.1,
      taxIncluded: true,
      invoiceCompliant: false,
      taxableTransferConsideration: consideration,
    },
  ]);
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  const accs: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year: 2026 }));
  await db.accounts.bulkPut(accs);
});

afterEach(async () => {
  await db.delete();
});

describe('課税資産の譲渡等の対価の読み取り（R18）', () => {
  test('1e3 は 1000 と同じに消費税を計算する', async () => {
    await seedSale('1000');
    const plain = await processYear(2026);
    await db.journalLines.update('l2', { taxableTransferConsideration: '1e3' });
    const legacy = await processYear(2026);
    expect(legacy.markedTransferBase10.toString()).toBe(plain.markedTransferBase10.toString());
    expect(plain.markedTransferBase10.isZero()).toBe(false);
  });

  test('指数の大きすぎる対価は 0 として数えず、仕訳の日付・摘要を示して止める', async () => {
    await seedSale('1' + '0'.repeat(1500));
    const expected = m.error_consideration_unreadable({
      date: '2026-05-01',
      description: '固定資産売却 車',
    });
    await expect(processYear(2026)).rejects.toThrow(expected);
    expect((await findOversizedAmounts({ year: 2026 })).total).toBe(1);
    await expect(exportYayoiCsv(2026)).rejects.toThrow();
    const entries = await db.journalEntries.toArray();
    const lines = await db.journalLines.toArray();
    expect(() =>
      buildYayoiCsvRows(
        entries,
        lines,
        ACCOUNTS_2026.map((a) => ({ ...a, year: 2026 })),
        [],
        {
          taxRegistration: 'taxable',
          taxFilingMethod: 'general',
        } as never,
      ),
    ).toThrow(expected);
  });
});
