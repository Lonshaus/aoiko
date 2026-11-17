import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Encoding from 'encoding-japanese';
import { db } from '../db/db';
import { parseCsv } from '../lib/csv';
import { toIndexable } from '../lib/decimal';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { exportYayoiCsvParts } from './accountant-export';
import type { JournalLine, ReportSnapshot } from '../db/types';

const YEAR = 2026;

function decodeSjis(bytes: Uint8Array): string {
  return Encoding.convert(Array.from(bytes), { to: 'UNICODE', from: 'SJIS', type: 'string' });
}

async function seedDepositDebit(extras: Partial<JournalLine> = {}): Promise<void> {
  await db.journalEntries.add({
    id: 'e1',
    date: '2026-04-01',
    year: YEAR,
    description: '普通預金への入金',
    status: 'confirmed',
    source: 'manual',
    createdAt: 0,
    confirmedAt: 0,
  });
  const base = {
    entryId: 'e1',
    amount: '22000',
    amountIndexed: toIndexable('22000'),
    taxIncluded: true,
    invoiceCompliant: false,
  };
  await db.journalLines.bulkAdd([
    { ...base, id: 'd', side: 'debit', accountCode: '1130', taxRate: 0.1, ...extras },
    { ...base, id: 'c', side: 'credit', accountCode: '3120', taxRate: 0 },
  ]);
}

async function addPlRecord(marked: boolean): Promise<void> {
  const record: ReportSnapshot = {
    id: 'pl',
    year: YEAR,
    type: 'pl',
    status: 'filed',
    filedAt: 1,
    payload: {
      type: 'pl',
      data: { rows: [], totalRevenue: '0', totalExpense: '0', netIncome: '0' },
    },
    generatedAt: 1,
    generatedFromEntriesUpTo: `${YEAR}-12-31`,
  };
  if (marked) {
    record.excludesNonPurchaseAssets = true;
  }
  await db.reportSnapshots.add(record);
}

async function exportDebitTax(): Promise<{ tax: string | undefined; reasons: string[][] }> {
  const { parts, notices } = await exportYayoiCsvParts(YEAR);
  const rows = parts.flatMap((p) => parseCsv(decodeSjis(p)));
  expect(rows).toHaveLength(1);
  return { tax: rows[0]?.[7], reasons: notices.map((n) => n.reasons) };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.accounts.bulkAdd(ACCOUNTS_2026);
});

afterEach(async () => {
  await db.delete();
});

describe('弥生形式 CSV の申告時の仕入判定', () => {
  test('印の無い申告記録の年分は、普通預金の借方を仕入の税区分で出し、理由を知らせる', async () => {
    await seedDepositDebit();
    await addPlRecord(false);

    const { tax, reasons } = await exportDebitTax();
    expect(tax).toBe('課対仕入込10%区分80%');
    expect(reasons).toEqual([['legacyPurchase']]);
  });

  test.each([
    ['印のある申告記録', true],
    ['申告記録なし', false],
  ])('%s の年分は対象外で、理由を知らせない', async (_label, withMarkedRecord) => {
    await seedDepositDebit();
    if (withMarkedRecord) {
      await addPlRecord(true);
    }

    const { tax, reasons } = await exportDebitTax();
    expect(tax).toBe('対象外');
    expect(reasons).toEqual([]);
  });

  test('申告時の判定の年分でも、輸入消費税の行は税区分が変わらないため知らせない', async () => {
    await seedDepositDebit({ taxCategory: 'importTax10' });
    await addPlRecord(false);

    const { tax, reasons } = await exportDebitTax();
    expect(tax).toBe('課対輸税7.8%');
    expect(reasons).toEqual([]);
  });

  test.each([
    [
      '印の無い申告記録の年分は、同じ取引先の控除上限に普通預金の借方も数えるため、上限を超えた通信費を区分控不にして理由を知らせる',
      false,
      '課対仕入込10%区分控不',
      [['legacyPurchase'], ['amount', 'legacyPurchase']],
    ],
    [
      '印のある申告記録の年分は、普通預金の借方を控除上限に数えないため、通信費は区分80%のままで、理由は金額だけになる',
      true,
      '課対仕入込10%区分80%',
      [[], ['amount']],
    ],
  ] as const)('%s', async (_label, marked, expectedTax, expectedReasons) => {
    await db.journalEntries.bulkAdd([
      {
        id: 'dep',
        date: '2026-03-01',
        year: YEAR,
        description: '普通預金への入金',
        status: 'confirmed',
        source: 'manual',
        createdAt: 0,
        confirmedAt: 0,
      },
      {
        id: 'buy',
        date: '2026-04-01',
        year: YEAR,
        description: '通信費',
        status: 'confirmed',
        source: 'manual',
        createdAt: 0,
        confirmedAt: 0,
      },
    ]);
    const line = (
      id: string,
      entryId: string,
      side: 'debit' | 'credit',
      accountCode: string,
      amount: string,
    ): JournalLine => ({
      id,
      entryId,
      side,
      accountCode,
      amount,
      amountIndexed: toIndexable(amount),
      taxRate: side === 'debit' ? 0.1 : 0,
      taxIncluded: true,
      invoiceCompliant: false,
      ...(side === 'debit' ? { vendorId: 'v1' } : {}),
    });
    await db.journalLines.bulkAdd([
      line('dep-d', 'dep', 'debit', '1130', '1000000000'),
      line('dep-c', 'dep', 'credit', '3120', '1000000000'),
      line('exp', 'buy', 'debit', '5150', '110000'),
      line('buy-c', 'buy', 'credit', '3120', '110000'),
    ]);
    await addPlRecord(marked);

    const { parts, notices } = await exportYayoiCsvParts(YEAR);
    const rows = parts.flatMap((p) => parseCsv(decodeSjis(p)));
    expect(rows.find((r) => r[4] === '通信費')?.[7]).toBe(expectedTax);
    expect(notices.find((n) => n.date === '2026-04-01')?.reasons ?? []).toEqual(expectedReasons[0]);
    expect(notices.find((n) => n.date === '2026-03-01')?.reasons).toEqual(expectedReasons[1]);
    expect(notices.length).toBe(marked ? 1 : 2);
  });
});
