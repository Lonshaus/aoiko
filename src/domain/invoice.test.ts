import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { newId } from '../lib/id';
import {
  convertQuoteToInvoiceDraft,
  createDraftInvoice,
  DEFAULT_INVOICE_PREFIX,
  DEFAULT_QUOTE_PREFIX,
  groupLineItemsByTaxRate,
  invoiceTotal,
  issueInvoice,
  voidInvoice,
} from './invoice';
import type { Invoice, InvoiceLineItem, Vendor } from '../db/types';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

async function seedVendor(): Promise<string> {
  const vendor: Vendor = { id: newId(), name: '取引先A' };
  await db.vendors.add(vendor);
  return vendor.id;
}

function lineItem(overrides: Partial<InvoiceLineItem>): InvoiceLineItem {
  return { id: newId(), name: '商品A', quantity: '1', unitPrice: '1000', taxRate: 0.1, ...overrides };
}

describe('groupLineItemsByTaxRate / invoiceTotal', () => {
  test('税率ごとに小計・消費税額（切り捨て）・税込合計を計算する', () => {
    const items = [
      lineItem({ quantity: '3', unitPrice: '1000', taxRate: 0.1 }),
      lineItem({ quantity: '1', unitPrice: '333', taxRate: 0.08 }),
    ];
    const groups = groupLineItemsByTaxRate(items);
    expect(groups).toHaveLength(2);
    const g10 = groups.find((g) => g.taxRate === 0.1)!;
    expect(g10.subtotalExcl.toString()).toBe('3000');
    expect(g10.taxAmount.toString()).toBe('300');
    expect(g10.grossAmount.toString()).toBe('3300');
    const g8 = groups.find((g) => g.taxRate === 0.08)!;
    expect(g8.subtotalExcl.toString()).toBe('333');
    expect(g8.taxAmount.toString()).toBe('26'); // 333*0.08=26.64 → 切り捨て
    expect(g8.grossAmount.toString()).toBe('359');
    expect(invoiceTotal(items).toString()).toBe('3659');
  });

  test('同一税率の複数明細を1グループにまとめる', () => {
    const items = [
      lineItem({ quantity: '2', unitPrice: '500', taxRate: 0.1 }),
      lineItem({ quantity: '1', unitPrice: '1000', taxRate: 0.1 }),
    ];
    const groups = groupLineItemsByTaxRate(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.subtotalExcl.toString()).toBe('2000');
  });
});

describe('issueInvoice', () => {
  test('請求書発行で仕訳（借方売掛金・貸方売上高、税率別）と ArApEntry を生成する', async () => {
    const vendorId = await seedVendor();
    const draft = createDraftInvoice('invoice', vendorId, '2026-07-08');
    draft.lineItems = [lineItem({ quantity: '2', unitPrice: '5000', taxRate: 0.1 })];
    draft.dueDate = '2026-08-08';

    const issued = await issueInvoice(draft, DEFAULT_INVOICE_PREFIX);

    expect(issued.status).toBe('issued');
    expect(issued.number).toBe(`${DEFAULT_INVOICE_PREFIX}-2026-0001`);
    expect(issued.journalEntryId).toBeDefined();
    expect(issued.arApEntryId).toBeDefined();

    const entry = await db.journalEntries.get(issued.journalEntryId!);
    expect(entry?.status).toBe('confirmed');
    const lines = await db.journalLines.where('entryId').equals(issued.journalEntryId!).toArray();
    expect(lines).toHaveLength(2);
    const debit = lines.find((l) => l.side === 'debit')!;
    const credit = lines.find((l) => l.side === 'credit')!;
    expect(debit.accountCode).toBe('1310');
    expect(debit.amount).toBe('11000');
    expect(credit.accountCode).toBe('4110');
    expect(credit.amount).toBe('11000');
    expect(credit.taxRate).toBe(0.1);
    expect(credit.taxIncluded).toBe(true);

    const arApEntry = await db.arApEntries.get(issued.arApEntryId!);
    expect(arApEntry?.originalAmount).toBe('11000');
    expect(arApEntry?.dueDate).toBe('2026-08-08');
  });

  test('見積書発行は仕訳・ArApEntryを生成しない', async () => {
    const vendorId = await seedVendor();
    const draft = createDraftInvoice('quote', vendorId, '2026-07-08');
    draft.lineItems = [lineItem({ quantity: '1', unitPrice: '1000', taxRate: 0.1 })];

    const issued = await issueInvoice(draft, DEFAULT_QUOTE_PREFIX);

    expect(issued.status).toBe('issued');
    expect(issued.number).toBe(`${DEFAULT_QUOTE_PREFIX}-2026-0001`);
    expect(issued.journalEntryId).toBeUndefined();
    expect(issued.arApEntryId).toBeUndefined();
    expect(await db.journalEntries.count()).toBe(0);
    expect(await db.arApEntries.count()).toBe(0);
  });

  test('番号は文書種別・年ごとに連番になる', async () => {
    const vendorId = await seedVendor();
    const d1 = createDraftInvoice('invoice', vendorId, '2026-01-10');
    d1.lineItems = [lineItem({})];
    const i1 = await issueInvoice(d1, DEFAULT_INVOICE_PREFIX);
    expect(i1.number).toBe(`${DEFAULT_INVOICE_PREFIX}-2026-0001`);

    const d2 = createDraftInvoice('invoice', vendorId, '2026-02-10');
    d2.lineItems = [lineItem({})];
    const i2 = await issueInvoice(d2, DEFAULT_INVOICE_PREFIX);
    expect(i2.number).toBe(`${DEFAULT_INVOICE_PREFIX}-2026-0002`);

    const q1 = createDraftInvoice('quote', vendorId, '2026-02-10');
    q1.lineItems = [lineItem({})];
    const qi1 = await issueInvoice(q1, DEFAULT_QUOTE_PREFIX);
    expect(qi1.number).toBe(`${DEFAULT_QUOTE_PREFIX}-2026-0001`);
  });

  test('下書き以外は発行できない', async () => {
    const vendorId = await seedVendor();
    const draft = createDraftInvoice('invoice', vendorId, '2026-07-08');
    draft.lineItems = [lineItem({})];
    const issued = await issueInvoice(draft, DEFAULT_INVOICE_PREFIX);
    const reloaded = await db.invoices.get(issued.id);

    await expect(issueInvoice(reloaded!, DEFAULT_INVOICE_PREFIX)).rejects.toThrow(/下書き/);
  });
});

describe('voidInvoice', () => {
  test('発行済み請求書を取消すと打消し仕訳が作られ、ArApEntryが削除される', async () => {
    const vendorId = await seedVendor();
    const draft = createDraftInvoice('invoice', vendorId, '2026-07-08');
    draft.lineItems = [lineItem({ quantity: '1', unitPrice: '1000', taxRate: 0.1 })];
    const issued = await issueInvoice(draft, DEFAULT_INVOICE_PREFIX);

    await voidInvoice(issued.id);

    const orig = await db.journalEntries.get(issued.journalEntryId!);
    expect(orig?.status).toBe('reversed');
    const voided = await db.invoices.get(issued.id);
    expect(voided?.status).toBe('voided');
    expect(await db.arApEntries.get(issued.arApEntryId!)).toBeUndefined();
  });

  test('入金記録がある請求書は取消できない', async () => {
    const vendorId = await seedVendor();
    const draft = createDraftInvoice('invoice', vendorId, '2026-07-08');
    draft.lineItems = [lineItem({ quantity: '1', unitPrice: '1000', taxRate: 0.1 })];
    const issued = await issueInvoice(draft, DEFAULT_INVOICE_PREFIX);
    await db.arApEntries.update(issued.arApEntryId!, { paidAmount: '500' });

    await expect(voidInvoice(issued.id)).rejects.toThrow(/入金記録/);
  });

  test('下書きは取消できない', async () => {
    const vendorId = await seedVendor();
    const draft = createDraftInvoice('invoice', vendorId, '2026-07-08');
    await db.invoices.add(draft);

    await expect(voidInvoice(draft.id)).rejects.toThrow(/発行済み/);
  });

  test('発行済み見積書は仕訳・ArApEntryが無いままステータスだけ取消になる', async () => {
    const vendorId = await seedVendor();
    const draft = createDraftInvoice('quote', vendorId, '2026-07-08');
    draft.lineItems = [lineItem({})];
    const issued = await issueInvoice(draft, DEFAULT_QUOTE_PREFIX);

    await voidInvoice(issued.id);

    const voided = await db.invoices.get(issued.id);
    expect(voided?.status).toBe('voided');
    expect(await db.journalEntries.count()).toBe(0);
  });
});

describe('convertQuoteToInvoiceDraft', () => {
  test('見積書の明細をコピーした請求書の下書きを作る', () => {
    const quote: Invoice = {
      id: newId(),
      documentType: 'quote',
      status: 'issued',
      number: `${DEFAULT_QUOTE_PREFIX}-2026-0001`,
      vendorId: 'vendor-1',
      date: '2026-07-01',
      lineItems: [lineItem({ name: '商品X' })],
      memo: 'メモ',
      createdAt: Date.now(),
      issuedAt: Date.now(),
    };

    const draft = convertQuoteToInvoiceDraft(quote, '2026-07-08');

    expect(draft.documentType).toBe('invoice');
    expect(draft.status).toBe('draft');
    expect(draft.number).toBe('');
    expect(draft.vendorId).toBe('vendor-1');
    expect(draft.memo).toBe('メモ');
    expect(draft.lineItems).toHaveLength(1);
    expect(draft.lineItems[0]!.name).toBe('商品X');
    expect(draft.lineItems[0]!.id).not.toBe(quote.lineItems[0]!.id);
  });

  test('見積書以外は変換できない', () => {
    const invoice: Invoice = {
      id: newId(),
      documentType: 'invoice',
      status: 'issued',
      number: 'INV-2026-0001',
      vendorId: 'vendor-1',
      date: '2026-07-01',
      lineItems: [],
      createdAt: Date.now(),
    };
    expect(() => convertQuoteToInvoiceDraft(invoice, '2026-07-08')).toThrow(/見積書のみ/);
  });
});