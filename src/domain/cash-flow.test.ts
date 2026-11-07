import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import {
  addArApEntry,
  computeCashFlowForecast,
  InvalidPaymentAmountError,
  isPaymentAmountInvalid,
  OverpaymentError,
  recordPayment,
  remainingBalance,
} from './cash-flow';
import { createDraftInvoice, DEFAULT_INVOICE_PREFIX, issueInvoice } from './invoice';
import { newId } from '../lib/id';
import type { ArApEntry } from '../db/types';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('remainingBalance', () => {
  test('当初金額から入金済み・支払済みの額を引く', () => {
    const e: ArApEntry = {
      id: '1',
      type: 'receivable',
      description: '',
      dueDate: '2026-08-01',
      originalAmount: '100000',
      paidAmount: '30000',
      createdAt: 0,
    };
    expect(remainingBalance(e).toString()).toBe('70000');
  });
});

describe('addArApEntry / recordPayment', () => {
  test('新規登録は paidAmount=0 で作成される', async () => {
    await addArApEntry({
      type: 'receivable',
      description: 'A社',
      dueDate: '2026-08-01',
      originalAmount: '50000',
    });
    const rows = await db.arApEntries.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.paidAmount).toBe('0');
  });

  test('入金を記録すると paidAmount が加算される', async () => {
    await addArApEntry({
      type: 'receivable',
      description: 'A社',
      dueDate: '2026-08-01',
      originalAmount: '50000',
    });
    const row = (await db.arApEntries.toArray())[0]!;
    await recordPayment(row.id, '20000');
    const updated = await db.arApEntries.get(row.id);
    expect(updated!.paidAmount).toBe('20000');
  });

  test('残高を超える入金は例外を投げる', async () => {
    await addArApEntry({
      type: 'payable',
      description: 'B社',
      dueDate: '2026-08-01',
      originalAmount: '10000',
    });
    const row = (await db.arApEntries.toArray())[0]!;
    await expect(recordPayment(row.id, '20000')).rejects.toThrow(OverpaymentError);
  });

  test('負の額・数値として読めない額は例外を投げ、paidAmount を変えない', async () => {
    await addArApEntry({
      type: 'receivable',
      description: 'C社',
      dueDate: '2026-08-01',
      originalAmount: '10000',
    });
    const row = (await db.arApEntries.toArray())[0]!;
    await recordPayment(row.id, '3000');
    for (const amount of ['-5000', '－5000', 'abc', '1e3', '5,000円']) {
      await expect(recordPayment(row.id, amount)).rejects.toThrow(InvalidPaymentAmountError);
    }
    expect((await db.arApEntries.get(row.id))!.paidAmount).toBe('3000');
  });

  test('全角・カンマ付きの額は値として消し込む', async () => {
    await addArApEntry({
      type: 'payable',
      description: 'D社',
      dueDate: '2026-08-01',
      originalAmount: '10000',
    });
    const row = (await db.arApEntries.toArray())[0]!;
    await recordPayment(row.id, '５，０００');
    expect((await db.arApEntries.get(row.id))!.paidAmount).toBe('5000');
  });
});

describe('小数を含む金額の消込', () => {
  async function seedEntry(originalAmount: string): Promise<string> {
    await addArApEntry({
      type: 'receivable',
      description: 'E社',
      dueDate: '2026-08-01',
      originalAmount,
    });
    return (await db.arApEntries.toArray())[0]!.id;
  }
  // 単価 33.3 × 3 = 99.9、消費税 9（切り捨て）で売掛金は 108.9
  async function seedFractionalInvoiceEntry(): Promise<string> {
    const vendorId = newId();
    await db.vendors.add({ id: vendorId, name: '取引先F' });
    const draft = createDraftInvoice('invoice', vendorId, '2026-07-01');
    const [first] = draft.lineItems;
    await issueInvoice(
      { ...draft, lineItems: [{ ...first!, quantity: '3', unitPrice: '33.3', taxRate: 0.1 }] },
      DEFAULT_INVOICE_PREFIX,
    );
    const rows = await db.arApEntries.toArray();
    expect(rows[0]!.originalAmount).toBe('108.9');
    return rows[0]!.id;
  }

  test('整数の残高に小数の額を消し込もうとすると例外を投げ、paidAmount を変えない', async () => {
    const id = await seedEntry('1000');
    await expect(recordPayment(id, '100.5')).rejects.toThrow(InvalidPaymentAmountError);
    expect((await db.arApEntries.get(id))!.paidAmount).toBe('0');
  });

  test('請求書の小数の残高は、残高ちょうどの額で一度に消し込める', async () => {
    const id = await seedFractionalInvoiceEntry();
    await recordPayment(id, '108.9');
    const row = (await db.arApEntries.get(id))!;
    expect(remainingBalance(row).toString()).toBe('0');
  });

  test('請求書の小数の残高は、整数の額を先に消し込めば残りの小数の額で完済できる', async () => {
    const id = await seedFractionalInvoiceEntry();
    await recordPayment(id, '50');
    await recordPayment(id, '58.9');
    const row = (await db.arApEntries.get(id))!;
    expect(remainingBalance(row).toString()).toBe('0');
  });

  test('残高と一致しない小数の額は例外を投げ、paidAmount を変えない', async () => {
    const id = await seedFractionalInvoiceEntry();
    await recordPayment(id, '50');
    await expect(recordPayment(id, '58.8')).rejects.toThrow(InvalidPaymentAmountError);
    expect((await db.arApEntries.get(id))!.paidAmount).toBe('50');
  });

  test('isPaymentAmountInvalid は recordPayment と同じ基準で判定する', async () => {
    const intId = await seedEntry('1000');
    const intEntry = (await db.arApEntries.get(intId))!;
    expect(isPaymentAmountInvalid('100', intEntry)).toBe(false);
    expect(isPaymentAmountInvalid('１，０００', intEntry)).toBe(false);
    expect(isPaymentAmountInvalid('100.5', intEntry)).toBe(true);
    expect(isPaymentAmountInvalid('-5', intEntry)).toBe(true);
    expect(isPaymentAmountInvalid('abc', intEntry)).toBe(true);
    expect(isPaymentAmountInvalid('', intEntry)).toBe(true);

    await db.arApEntries.clear();
    const fracId = await seedFractionalInvoiceEntry();
    const fracEntry = (await db.arApEntries.get(fracId))!;
    expect(isPaymentAmountInvalid('108.9', fracEntry)).toBe(false);
    expect(isPaymentAmountInvalid('50', fracEntry)).toBe(false);
    expect(isPaymentAmountInvalid('58.8', fracEntry)).toBe(true);

    await recordPayment(fracId, '50');
    const partial = (await db.arApEntries.get(fracId))!;
    expect(isPaymentAmountInvalid('58.9', partial)).toBe(false);
    expect(isPaymentAmountInvalid('108.9', partial)).toBe(true);
  });
});

describe('computeCashFlowForecast', () => {
  function entry(over: Partial<ArApEntry>): ArApEntry {
    return {
      id: over.id ?? 'x',
      type: over.type ?? 'receivable',
      description: '',
      dueDate: over.dueDate ?? '2026-08-01',
      originalAmount: over.originalAmount ?? '10000',
      paidAmount: over.paidAmount ?? '0',
      createdAt: 0,
    };
  }

  test('期日の月ごとに売掛/買掛の残高をバケットへ集計する', () => {
    const entries = [
      entry({ id: 'r1', type: 'receivable', dueDate: '2026-07-10', originalAmount: '100000' }),
      entry({ id: 'p1', type: 'payable', dueDate: '2026-07-20', originalAmount: '30000' }),
      entry({ id: 'r2', type: 'receivable', dueDate: '2026-08-05', originalAmount: '50000' }),
    ];
    const r = computeCashFlowForecast(entries, '2026-07-01', 3);
    expect(r.months.map((m) => m.yearMonth)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(r.months[0]!.expectedInflow).toBe('100000');
    expect(r.months[0]!.expectedOutflow).toBe('30000');
    expect(r.months[0]!.netChange).toBe('70000');
    expect(r.months[1]!.expectedInflow).toBe('50000');
    expect(r.months[2]!.expectedInflow).toBe('0');
  });

  test('期限超過分は最初のバケットに繰り入れる', () => {
    const entries = [entry({ dueDate: '2026-05-01', originalAmount: '20000' })];
    const r = computeCashFlowForecast(entries, '2026-07-01', 2);
    expect(r.months[0]!.expectedInflow).toBe('20000');
  });

  test('完済済み（残高0）は集計から除外', () => {
    const entries = [
      entry({ dueDate: '2026-07-15', originalAmount: '10000', paidAmount: '10000' }),
    ];
    const r = computeCashFlowForecast(entries, '2026-07-01', 1);
    expect(r.months[0]!.expectedInflow).toBe('0');
  });

  test('予測期間より先の期日分は対象外', () => {
    const entries = [entry({ dueDate: '2027-01-01', originalAmount: '10000' })];
    const r = computeCashFlowForecast(entries, '2026-07-01', 1);
    expect(r.months[0]!.expectedInflow).toBe('0');
  });

  test('年をまたぐ月バケットも正しく生成される', () => {
    const entries = [entry({ dueDate: '2027-01-10', originalAmount: '5000' })];
    const r = computeCashFlowForecast(entries, '2026-11-01', 4);
    expect(r.months.map((m) => m.yearMonth)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(r.months[2]!.expectedInflow).toBe('5000');
  });
});
