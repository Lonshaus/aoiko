import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { D, toIndexable } from '../lib/decimal';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { buildYayoiCsvRows } from './accountant-export';
import {
  classifyNonInvoicePurchases,
  computeGeneral,
  computeSimplified,
  computeThreeWari,
  computeTwoWari,
  processYear,
} from './consumption-tax';
import type { JournalLine } from '../db/types';

const NON_PURCHASE_CODES = ['1110', '1120', '1130', '1140', '1310', '1320', '1420'];
const SMALL_AMOUNT_SPECIAL = { basePeriodSales: D(50_000_000) };

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

async function seedDebitWithTax(code: string, extras: Partial<JournalLine> = {}): Promise<void> {
  await seedEntry('e1', '2026-04-01', [
    { id: 'd', side: 'debit', accountCode: code, amount: '11000', taxRate: 0.1, ...extras },
    { id: 'c', side: 'credit', accountCode: '3120', amount: '11000' },
  ]);
}

async function yayoiRows(): Promise<string[][]> {
  return buildYayoiCsvRows(
    await db.journalEntries.toArray(),
    await db.journalLines.toArray(),
    ACCOUNTS_2026,
    [],
    { taxFilingMethod: 'general', simplifiedTaxCategory: 4 },
  );
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.accounts.bulkAdd(ACCOUNTS_2026);
});

afterEach(async () => {
  await db.delete();
});

describe('現金・預金・金銭債権の借方は課税仕入れにしない', () => {
  test.each(NON_PURCHASE_CODES)(
    '%s の借方 10% は仕入税額に入らず、弥生形式は対象外',
    async (code) => {
      await seedDebitWithTax(code);

      const processed = await processYear(2026);
      expect(processed.input.toString()).toBe('0');
      expect(processed.inputRaw.toString()).toBe('0');
      const [row] = await yayoiRows();
      expect(row![7]).toBe('対象外');
      expect(row![9]).toBe('');
    },
  );

  test.each(['1330', '1510', '1340', '1530'])(
    '%s の借方 10% はこれまでどおり仕入税額に入る',
    async (code) => {
      await seedDebitWithTax(code, { invoiceCompliant: true });

      const processed = await processYear(2026);
      expect(processed.input.toString()).toBe('780');
      expect(processed.inputRaw.toString()).toBe('780');
      const [row] = await yayoiRows();
      expect(row![7]).toBe('課対仕入込10%適格');
      expect(row![9]).toBe('1000');
    },
  );

  test.each(NON_PURCHASE_CODES)(
    '%s の貸方 10% はこれまでどおり仕入税額に入らない',
    async (code) => {
      await seedEntry('e1', '2026-04-01', [
        { id: 'd', side: 'debit', accountCode: '1610', amount: '11000' },
        { id: 'c', side: 'credit', accountCode: code, amount: '11000', taxRate: 0.1 },
      ]);

      const processed = await processYear(2026);
      expect(processed.input.toString()).toBe('0');
      expect(processed.inputRaw.toString()).toBe('0');
    },
  );

  test('事業主貸の借方 10% はこれまでどおり仕入税額に入らない', async () => {
    await seedDebitWithTax('1610');

    const processed = await processYear(2026);
    expect(processed.input.toString()).toBe('0');
    expect(processed.inputRaw.toString()).toBe('0');
  });
});

describe('少額特例と控除上限の判定も同じ科目を除く', () => {
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

  test('費用 3,300 円と普通預金 22,000 円の伝票は、費用の行に少額特例が当たり全額控除', async () => {
    await seedSmallPurchaseWithDeposit();

    const processed = await processYear(2026, undefined, {
      smallAmountSpecial: SMALL_AMOUNT_SPECIAL,
    });
    expect(processed.inputRaw.toString()).toBe('234');
    expect(processed.input.toString()).toBe('234');
    const accountMap = new Map(ACCOUNTS_2026.map((a) => [a.code, a]));
    const { smallAmountLineIds } = classifyNonInvoicePurchases(
      2026,
      new Map([
        ['sale', '2026-03-01'],
        ['buy', '2026-04-01'],
      ]),
      await db.journalLines.toArray(),
      accountMap,
      SMALL_AMOUNT_SPECIAL,
    );
    expect([...smallAmountLineIds]).toEqual(['expense']);
  });

  test('控除上限の累計に普通預金の借方は入らない', async () => {
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

    const accountMap = new Map(ACCOUNTS_2026.map((a) => [a.code, a]));
    const { capExcess } = classifyNonInvoicePurchases(
      2026,
      new Map([
        ['deposit', '2026-03-01'],
        ['buy', '2026-04-01'],
      ]),
      await db.journalLines.toArray(),
      accountMap,
    );
    expect(capExcess.size).toBe(0);
    const processed = await processYear(2026);
    expect(processed.input.toString()).toBe('6240');
    const rows = await yayoiRows();
    const expenseRow = rows.find((r) => r[4] === '通信費');
    expect(expenseRow?.[7]).toBe('課対仕入込10%区分80%');
  });

  test('本則課税の納付税額は普通預金の行の有無で変わらない', async () => {
    await seedSmallPurchaseWithDeposit();
    const options = { smallAmountSpecial: SMALL_AMOUNT_SPECIAL };

    const withDeposit = await computeGeneral(2026, 'proportional', undefined, options);
    await db.journalLines.delete('deposit');
    const withoutDeposit = await computeGeneral(2026, 'proportional', undefined, options);
    expect(withDeposit).toEqual(withoutDeposit);
    expect(withDeposit.netTax.national).toBe('7566');
  });

  test('簡易課税・2割特例・3割特例の納付税額は普通預金の行の有無で変わらない', async () => {
    await seedSmallPurchaseWithDeposit();

    const before = [
      await computeSimplified(2026, 4),
      await computeTwoWari(2026),
      await computeThreeWari(2026),
    ];
    await db.journalLines.delete('deposit');
    const after = [
      await computeSimplified(2026, 4),
      await computeTwoWari(2026),
      await computeThreeWari(2026),
    ];
    expect(before.map((r) => r.netTax)).toEqual(after.map((r) => r.netTax));
    expect(before.map((r) => r.filingRounded)).toEqual(after.map((r) => r.filingRounded));
  });
});
