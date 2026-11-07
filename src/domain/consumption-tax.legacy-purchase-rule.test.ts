import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { D, toIndexable } from '../lib/decimal';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import {
  classifyNonInvoicePurchases,
  computeGeneral,
  countsAsPurchaseInput,
  processYear,
} from './consumption-tax';
import type { JournalLine, ReportSnapshot } from '../db/types';

const YEAR = 2026;
const NON_PURCHASE_CODES = ['1110', '1120', '1130', '1140', '1310', '1320', '1420'];
const SMALL_AMOUNT_SPECIAL = { basePeriodSales: D(50_000_000) };
const accountMap = new Map(ACCOUNTS_2026.map((a) => [a.code, a]));

type LineSeed = Partial<JournalLine> & Pick<JournalLine, 'id' | 'side' | 'accountCode' | 'amount'>;

async function seedEntry(id: string, date: string, lines: LineSeed[]): Promise<void> {
  await db.journalEntries.add({
    id,
    date,
    year: Number(date.slice(0, 4)),
    description: 'テスト',
    status: 'confirmed',
    source: 'manual',
    createdAt: 0,
    confirmedAt: 0,
  });
  await db.journalLines.bulkAdd(
    lines.map((l) => ({
      entryId: id,
      amountIndexed: toIndexable(l.amount),
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
      ...l,
    })),
  );
}

async function seedSmallPurchaseWithDeposit(): Promise<void> {
  await seedEntry('sale', '2026-03-01', [
    { id: 'sale-d', side: 'debit', accountCode: '1130', amount: '110000' },
    { id: 'sale-c', side: 'credit', accountCode: '4110', amount: '110000', taxRate: 0.1 },
  ]);
  await seedEntry('buy', '2026-04-01', [
    { id: 'expense', side: 'debit', accountCode: '5150', amount: '3300', taxRate: 0.1 },
    { id: 'deposit', side: 'debit', accountCode: '1130', amount: '22000', taxRate: 0.1 },
    { id: 'buy-c', side: 'credit', accountCode: '3120', amount: '25300' },
  ]);
}

async function seedCapCase(): Promise<void> {
  await seedEntry('deposit', '2026-03-01', [
    {
      id: 'deposit-d',
      side: 'debit',
      accountCode: '1130',
      amount: '1000000000',
      taxRate: 0.1,
      vendorId: 'v1',
    },
    { id: 'deposit-c', side: 'credit', accountCode: '3120', amount: '1000000000' },
  ]);
  await seedEntry('buy', '2026-04-01', [
    {
      id: 'expense',
      side: 'debit',
      accountCode: '5150',
      amount: '110000',
      taxRate: 0.1,
      vendorId: 'v1',
    },
    { id: 'buy-c', side: 'credit', accountCode: '3120', amount: '110000' },
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

async function entryDates(): Promise<Map<string, string>> {
  const entries = await db.journalEntries.toArray();
  return new Map(entries.map((e) => [e.id, e.date]));
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.accounts.bulkAdd(ACCOUNTS_2026);
});

afterEach(async () => {
  await db.delete();
});

describe('印の無い申告記録がある年分は、現金預金・金銭債権の借方も仕入に含める', () => {
  test('普通預金の借方が仕入税額に入り、少額特例は伝票全体の税込額で判定する', async () => {
    await seedSmallPurchaseWithDeposit();
    await addPlRecord(false);

    const processed = await processYear(YEAR, undefined, {
      smallAmountSpecial: SMALL_AMOUNT_SPECIAL,
    });
    expect(processed.inputRaw.toString()).toBe('1794');
    expect(processed.input.toString()).toBe('1435.2');
    const legacy = classifyNonInvoicePurchases(
      YEAR,
      await entryDates(),
      await db.journalLines.toArray(),
      accountMap,
      SMALL_AMOUNT_SPECIAL,
      true,
    );
    expect([...legacy.smallAmountLineIds]).toEqual([]);
  });

  test('控除上限の累計に普通預金の借方を入れる', async () => {
    await seedCapCase();
    await addPlRecord(false);

    const { capExcess } = classifyNonInvoicePurchases(
      YEAR,
      await entryDates(),
      await db.journalLines.toArray(),
      accountMap,
      {},
      true,
    );
    expect([...capExcess.keys()]).toEqual(['expense']);
    expect(capExcess.get('expense')?.toString()).toBe('110000');
    const withExpense = await processYear(YEAR);
    await db.journalLines.delete('expense');
    const withoutExpense = await processYear(YEAR);
    expect(withExpense.input.toString()).toBe(withoutExpense.input.toString());
  });

  test('本則課税の納付税額は申告時の判定で計算する', async () => {
    await seedSmallPurchaseWithDeposit();
    await addPlRecord(false);

    const result = await computeGeneral(YEAR, 'proportional', undefined, {
      smallAmountSpecial: SMALL_AMOUNT_SPECIAL,
    });
    expect(result.filingRounded.national).toBe('6300');
  });
});

describe('印のある申告記録だけの年分と、申告記録の無い年分は今の判定', () => {
  test.each([
    ['印のある申告記録', true],
    ['申告記録なし', false],
  ])('%s', async (_label, withMarkedRecord) => {
    await seedSmallPurchaseWithDeposit();
    if (withMarkedRecord) {
      await addPlRecord(true);
    }

    const processed = await processYear(YEAR, undefined, {
      smallAmountSpecial: SMALL_AMOUNT_SPECIAL,
    });
    expect(processed.inputRaw.toString()).toBe('234');
    expect(processed.input.toString()).toBe('234');
    const result = await computeGeneral(YEAR, 'proportional', undefined, {
      smallAmountSpecial: SMALL_AMOUNT_SPECIAL,
    });
    expect(result.netTax.national).toBe('7566');
    expect(result.filingRounded.national).toBe('7500');
  });

  test.each([
    ['印のある申告記録', true],
    ['申告記録なし', false],
  ])('%s：控除上限の累計に普通預金の借方は入らない', async (_label, withMarkedRecord) => {
    await seedCapCase();
    if (withMarkedRecord) {
      await addPlRecord(true);
    }

    const processed = await processYear(YEAR);
    expect(processed.input.toString()).toBe('6240');
  });
});

describe('countsAsPurchaseInput の legacy', () => {
  test.each(NON_PURCHASE_CODES)('%s の借方は legacy のときだけ仕入', (code) => {
    const acc = accountMap.get(code);
    expect(acc).toBeDefined();
    const line: JournalLine = {
      id: 'l',
      entryId: 'e',
      side: 'debit',
      accountCode: code,
      amount: '11000',
      amountIndexed: toIndexable('11000'),
      taxRate: 0.1,
      taxIncluded: true,
      invoiceCompliant: false,
    };
    expect(countsAsPurchaseInput(line, acc!, true)).toBe(true);
    expect(countsAsPurchaseInput(line, acc!, false)).toBe(false);
    expect(countsAsPurchaseInput(line, acc!)).toBe(false);
  });
});
