import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { newId } from '../lib/id';
import { D, Decimal } from '../lib/decimal';
import {
  convertQuoteToInvoiceDraft,
  createDraftInvoice,
  DEFAULT_INVOICE_PREFIX,
  DEFAULT_QUOTE_PREFIX,
  formatUnitPrice,
  groupLineItemsByTaxRate,
  hasReducedRateItems,
  hasUnreadableLineItems,
  invoiceTotal,
  isInvoiceTotalTooLarge,
  isLineItemInvalid,
  readInvoiceLineValue,
  issueInvoice,
  normalizeLineItems,
  voidInvoice,
} from './invoice';
import type { Invoice, InvoiceLineItem, Vendor } from '../db/types';
import { m } from '../paraglide/messages';
import { setLocale } from '../paraglide/runtime';

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
  return {
    id: newId(),
    name: '商品A',
    quantity: '1',
    unitPrice: '1000',
    taxRate: 0.1,
    ...overrides,
  };
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

describe('明細の数量・単価の読み取り', () => {
  // D() だけで合計した値を基準にして、D() が読める値の合計が変わらないことを確かめる
  function legacyGroups(items: InvoiceLineItem[]): string[][] {
    const groups = new Map<0.1 | 0.08, Decimal>();
    for (const item of items) {
      const amount = D(item.quantity).times(item.unitPrice);
      groups.set(item.taxRate, (groups.get(item.taxRate) ?? D(0)).plus(amount));
    }
    return [...groups.entries()]
      .sort(([a], [b]) => b - a)
      .map(([taxRate, subtotalExcl]) => {
        const taxAmount = subtotalExcl.times(taxRate).toDecimalPlaces(0, Decimal.ROUND_DOWN);
        return [String(taxRate), subtotalExcl, taxAmount, subtotalExcl.plus(taxAmount)].map(String);
      });
  }

  function groupsOf(items: InvoiceLineItem[]): string[][] {
    return groupLineItemsByTaxRate(items).map((g) =>
      [String(g.taxRate), g.subtotalExcl, g.taxAmount, g.grossAmount].map(String),
    );
  }

  const D_ACCEPTED = [
    '1',
    '-1',
    '2.5',
    '+5',
    '1e3',
    '1E3',
    '1e-1',
    '-1.5e2',
    '0x10',
    '0X1F',
    '0b101',
    '0o17',
    '0x1.8p1',
    '5000.',
    '.5',
    '-0',
    5 as never,
    -2.5 as never,
  ];

  test('保存済みの有限な D() が読める数量・単価の組はすべて、変更前と同じ小計・税額・合計になる', () => {
    for (const quantity of D_ACCEPTED) {
      for (const unitPrice of D_ACCEPTED) {
        const items = [
          lineItem({ quantity, unitPrice, taxRate: 0.1 }),
          lineItem({ quantity: '3', unitPrice: '333', taxRate: 0.08 }),
        ];
        expect(groupsOf(items), `${String(quantity)} × ${String(unitPrice)}`).toEqual(
          legacyGroups(items),
        );
      }
    }
  });

  test.each(['NaN', 'Infinity', '-Infinity'])(
    '非有限の %j は読めない値として 0 に数え、行は無効になる',
    (v) => {
      const items = [lineItem({ quantity: v }), lineItem({ quantity: '2', unitPrice: '500' })];
      expect(invoiceTotal(items).toString()).toBe('1100');
      expect(isLineItemInvalid(items[0]!)).toBe(true);
    },
  );

  test('負の数量の行（値引き）は変更前と同じく差し引いて合計する', () => {
    const items = [
      lineItem({ quantity: '2', unitPrice: '1000' }),
      lineItem({ quantity: '-1', unitPrice: '500' }),
    ];
    expect(groupsOf(items)).toEqual(legacyGroups(items));
    expect(invoiceTotal(items).toString()).toBe('1650');
    expect(items.some(isLineItemInvalid)).toBe(false);
  });

  test('全角・桁区切り・前後の空白の数量・単価は値として読み、例外を投げない', () => {
    const items = [
      lineItem({ quantity: '２', unitPrice: '５，０００' }),
      lineItem({ quantity: ' 1 ', unitPrice: '－500' }),
      lineItem({ quantity: '1', unitPrice: '1,000', taxRate: 0.08 }),
    ];
    const groups = groupLineItemsByTaxRate(items);
    expect(groups.map((g) => g.subtotalExcl.toString())).toEqual(['9500', '1000']);
    expect(invoiceTotal(items).toString()).toBe('11530');
    expect(items.some(isLineItemInvalid)).toBe(false);
  });

  test('空欄の数量の行は 0 として数え、隣の行の全角の単価は値どおりに合計する', () => {
    const items = [
      lineItem({ quantity: '', unitPrice: '1000' }),
      lineItem({ quantity: '1', unitPrice: '５０００' }),
    ];
    expect(invoiceTotal(items).toString()).toBe('5500');
    expect(isLineItemInvalid(items[0]!)).toBe(true);
    expect(isLineItemInvalid(items[1]!)).toBe(false);
  });

  test.each([
    ['', '1000'],
    ['1', ''],
    ['   ', '1000'],
    ['1', '　'],
    ['abc', '1000'],
    ['1', '5,000円'],
    ['1/2', '1000'],
    ['1', '--5'],
    ['NaN', '1000'],
    ['1', 'Infinity'],
    [null as never, '1000'],
    ['1', undefined as never],
  ])('数量 %j・単価 %j の行は読めない行として扱い、合計では 0 として数える', (q, p) => {
    const item = lineItem({ quantity: q, unitPrice: p });
    expect(isLineItemInvalid(item)).toBe(true);
    expect(() => invoiceTotal([item])).not.toThrow();
  });

  test.each(['1', '-1', '５', '5,000', ' 5 ', '－1', '1.5'])(
    '数量 %j の行は有効な入力として扱う',
    (q) => {
      expect(isLineItemInvalid(lineItem({ quantity: q, unitPrice: q }))).toBe(false);
    },
  );

  test.each(['1e3', '0x10'])(
    '数量 %j は保存済みの値としては読めるが、入力としては無効で発行できない',
    (q) => {
      const item = lineItem({ quantity: q, unitPrice: '1' });
      expect(readInvoiceLineValue(q)?.isFinite()).toBe(true);
      expect(isLineItemInvalid(item)).toBe(true);
    },
  );

  test('保存する明細は D() が読めない値だけを半角に揃え、読める値と読めない値はそのまま残す', () => {
    const items = [
      lineItem({ quantity: '１', unitPrice: '５，０００' }),
      lineItem({ quantity: ' 2 ', unitPrice: '－500' }),
      lineItem({ quantity: '1e1', unitPrice: '5000.' }),
      lineItem({ quantity: '', unitPrice: 'abc' }),
    ];
    expect(normalizeLineItems(items).map((i) => [i.quantity, i.unitPrice])).toEqual([
      ['1', '5000'],
      ['2', '-500'],
      ['1e1', '5000.'],
      ['', 'abc'],
    ]);
    expect(normalizeLineItems(items).map((i) => i.id)).toEqual(items.map((i) => i.id));
  });

  test('印刷する単価は読める値なら円表示にし、読めない値は例外を投げずそのまま出す', () => {
    expect(formatUnitPrice('５０００')).toBe('¥5,000');
    expect(formatUnitPrice('-500')).toBe('-¥500');
    expect(formatUnitPrice('1e3')).toBe('¥1,000');
    expect(formatUnitPrice('abc')).toBe('abc');
    expect(formatUnitPrice('')).toBe('');
  });
});

describe('hasReducedRateItems', () => {
  test('8% の明細が 1 行でもあれば true', () => {
    const items = [
      lineItem({ quantity: '1', unitPrice: '1000', taxRate: 0.1 }),
      lineItem({ quantity: '1', unitPrice: '500', taxRate: 0.08 }),
    ];
    expect(hasReducedRateItems(items)).toBe(true);
  });

  test('10% だけなら false', () => {
    const items = [lineItem({ quantity: '2', unitPrice: '1000', taxRate: 0.1 })];
    expect(hasReducedRateItems(items)).toBe(false);
  });

  test('明細が空なら false', () => {
    expect(hasReducedRateItems([])).toBe(false);
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

  test('ArApEntry の摘要には取引先 ID ではなく取引先名を保存する', async () => {
    const vendorId = await seedVendor();
    const draft = createDraftInvoice('invoice', vendorId, '2026-07-08');
    draft.lineItems = [lineItem({})];

    const issued = await issueInvoice(draft, DEFAULT_INVOICE_PREFIX);

    const arApEntry = await db.arApEntries.get(issued.arApEntryId!);
    expect(arApEntry?.description).toBe(`${DEFAULT_INVOICE_PREFIX}-2026-0001（取引先A）`);
    expect(arApEntry?.description).not.toContain(vendorId);
  });

  test('取引先が見つからなければ摘要は番号だけにする', async () => {
    const draft = createDraftInvoice('invoice', 'missing-vendor', '2026-07-08');
    draft.lineItems = [lineItem({})];

    const issued = await issueInvoice(draft, DEFAULT_INVOICE_PREFIX);

    const arApEntry = await db.arApEntries.get(issued.arApEntryId!);
    expect(arApEntry?.description).toBe(`${DEFAULT_INVOICE_PREFIX}-2026-0001`);
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

  test('12/31 付の文書も件数に入り、番号が重複しない', async () => {
    const vendorId = await seedVendor();
    const d1 = createDraftInvoice('invoice', vendorId, '2026-12-31');
    d1.lineItems = [lineItem({})];
    const i1 = await issueInvoice(d1, DEFAULT_INVOICE_PREFIX);
    expect(i1.number).toBe(`${DEFAULT_INVOICE_PREFIX}-2026-0001`);

    const d2 = createDraftInvoice('invoice', vendorId, '2026-12-31');
    d2.lineItems = [lineItem({})];
    const i2 = await issueInvoice(d2, DEFAULT_INVOICE_PREFIX);
    expect(i2.number).toBe(`${DEFAULT_INVOICE_PREFIX}-2026-0002`);
  });

  test('同じ下書きを二度発行しても仕訳・売掛金は1件ずつしか作られない', async () => {
    const vendorId = await seedVendor();
    const draft = createDraftInvoice('invoice', vendorId, '2026-07-08');
    draft.lineItems = [lineItem({})];
    // ボタン二度押し相当：どちらも同じローカルスナップショット（status='draft'）を渡す
    const results = await Promise.allSettled([
      issueInvoice(draft, DEFAULT_INVOICE_PREFIX),
      issueInvoice(draft, DEFAULT_INVOICE_PREFIX),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await db.journalEntries.count()).toBe(1);
    expect(await db.arApEntries.count()).toBe(1);
    expect(await db.invoices.count()).toBe(1);
  });

  test('下書き以外は発行できない', async () => {
    const vendorId = await seedVendor();
    const draft = createDraftInvoice('invoice', vendorId, '2026-07-08');
    draft.lineItems = [lineItem({})];
    const issued = await issueInvoice(draft, DEFAULT_INVOICE_PREFIX);
    const reloaded = await db.invoices.get(issued.id);

    await expect(issueInvoice(reloaded!, DEFAULT_INVOICE_PREFIX)).rejects.toThrow(/下書き/);
  });

  test('全角の単価・数量で発行すると、明細は半角の数字で保存され、仕訳と売掛金は値どおりになる', async () => {
    const vendorId = await seedVendor();
    const draft = createDraftInvoice('invoice', vendorId, '2026-07-08');
    draft.lineItems = [lineItem({ quantity: '１', unitPrice: '５０００' })];

    const issued = await issueInvoice(draft, DEFAULT_INVOICE_PREFIX);

    expect(issued.lineItems.map((i) => [i.quantity, i.unitPrice])).toEqual([['1', '5000']]);
    const lines = await db.journalLines.where('entryId').equals(issued.journalEntryId!).toArray();
    expect(lines.map((l) => l.amount)).toEqual(['5500', '5500']);
    expect((await db.arApEntries.get(issued.arApEntryId!))?.originalAmount).toBe('5500');
  });

  test('見積書も明細を半角の数字に揃えて保存する', async () => {
    const vendorId = await seedVendor();
    const draft = createDraftInvoice('quote', vendorId, '2026-07-08');
    draft.lineItems = [lineItem({ quantity: '２', unitPrice: '1,000' })];

    const issued = await issueInvoice(draft, DEFAULT_QUOTE_PREFIX);

    expect(issued.lineItems.map((i) => [i.quantity, i.unitPrice])).toEqual([['2', '1000']]);
  });

  test('指数・小数点だけの末尾など D() だけが読める形の明細は発行できず、何も書き込まない', async () => {
    const vendorId = await seedVendor();
    const draft = createDraftInvoice('invoice', vendorId, '2026-07-08');
    draft.lineItems = [
      lineItem({ quantity: '1e1', unitPrice: '5000.' }),
      lineItem({ quantity: '-1', unitPrice: '500' }),
    ];

    await expect(issueInvoice(draft, DEFAULT_INVOICE_PREFIX)).rejects.toThrow(
      m.invoices_line_invalid(),
    );
    expect(await db.invoices.count()).toBe(0);
    expect(await db.journalEntries.count()).toBe(0);
  });

  test('一般の書き方の明細は標準の形で保存され、値引きを差し引いた金額で発行される', async () => {
    const vendorId = await seedVendor();
    const draft = createDraftInvoice('invoice', vendorId, '2026-07-08');
    draft.lineItems = [
      lineItem({ quantity: '10', unitPrice: '5000' }),
      lineItem({ quantity: '-1', unitPrice: '500' }),
    ];

    const issued = await issueInvoice(draft, DEFAULT_INVOICE_PREFIX);

    expect(issued.lineItems.map((i) => [i.quantity, i.unitPrice])).toEqual([
      ['10', '5000'],
      ['-1', '500'],
    ]);
    expect((await db.arApEntries.get(issued.arApEntryId!))?.originalAmount).toBe('54450');
  });

  test.each([
    ['', '1000'],
    ['abc', '1000'],
    ['1', '5,000円'],
    ['NaN', '1000'],
  ])('数量 %j・単価 %j の明細があると発行できず、何も書き込まない', async (q, p) => {
    const vendorId = await seedVendor();
    const draft = createDraftInvoice('invoice', vendorId, '2026-07-08');
    draft.lineItems = [lineItem({}), lineItem({ quantity: q, unitPrice: p })];

    await expect(issueInvoice(draft, DEFAULT_INVOICE_PREFIX)).rejects.toThrow(
      m.invoices_line_invalid(),
    );
    expect(await db.invoices.count()).toBe(0);
    expect(await db.journalEntries.count()).toBe(0);
    expect(await db.arApEntries.count()).toBe(0);
  });

  test('取引先未選択（vendorId空）は発行できない', async () => {
    const draft = createDraftInvoice('invoice', '', '2026-07-08');
    draft.lineItems = [lineItem({})];

    await expect(issueInvoice(draft, DEFAULT_INVOICE_PREFIX)).rejects.toThrow(/取引先/);
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

  test('入金記録ありの拒否理由は表示言語に従う', async () => {
    const vendorId = await seedVendor();
    const draft = createDraftInvoice('invoice', vendorId, '2026-07-08');
    draft.lineItems = [lineItem({ quantity: '1', unitPrice: '1000', taxRate: 0.1 })];
    const issued = await issueInvoice(draft, DEFAULT_INVOICE_PREFIX);
    await db.arApEntries.update(issued.arApEntryId!, { paidAmount: '500' });

    setLocale('en', { reload: false });
    try {
      await expect(voidInvoice(issued.id)).rejects.toThrow(/recorded payment/);
    } finally {
      setLocale('ja', { reload: false });
    }
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

describe('請求書の数量・単価の入力検査', () => {
  test.each(['0x10', '1e3', '0b1', 'NaN', 'Infinity'])(
    '数量 %j の行は入力として受け付けない',
    (q) => {
      expect(isLineItemInvalid(lineItem({ quantity: q }))).toBe(true);
    },
  );

  test.each(['0x10', '1e3'])('数量 %j の請求書は発行できず、何も書き込まない', async (q) => {
    const vendorId = await seedVendor();
    const draft = createDraftInvoice('invoice', vendorId, '2026-07-08');
    draft.lineItems = [lineItem({ quantity: q })];

    await expect(issueInvoice(draft, DEFAULT_INVOICE_PREFIX)).rejects.toThrow(
      m.invoices_line_invalid(),
    );
    expect(await db.journalEntries.count()).toBe(0);
  });

  test('保存済みの 1e3 の明細は合計が変わらない', () => {
    const items = [lineItem({ quantity: '1e3', unitPrice: '2' })];
    expect(invoiceTotal(items).toString()).toBe('2200');
  });

  test.each(['NaN', 'Infinity', '-Infinity'])('%j は読めない値で、合計が NaN にならない', (v) => {
    expect(readInvoiceLineValue(v)).toBeUndefined();
    expect(invoiceTotal([lineItem({ quantity: v })]).toString()).toBe('0');
  });

  test('長い 16 進文字列は 1 秒以内に読めない値になり、指数が範囲外の値も読めない', () => {
    const start = Date.now();
    expect(readInvoiceLineValue('0x' + 'f'.repeat(200000))).toBeUndefined();
    expect(Date.now() - start).toBeLessThan(1000);
    expect(readInvoiceLineValue('1e-5000')).toBeUndefined();
    expect(readInvoiceLineValue('1.' + '5'.repeat(200000))).toBeUndefined();
  });

  test('合計が 1e14 以上の請求書は発行せず、仕訳を作らない', async () => {
    const vendorId = await seedVendor();
    const draft = createDraftInvoice('invoice', vendorId, '2026-07-08');
    draft.lineItems = [lineItem({ quantity: '1', unitPrice: '100000000000000' })];
    expect(isInvoiceTotalTooLarge(draft.lineItems)).toBe(true);

    await expect(issueInvoice(draft, DEFAULT_INVOICE_PREFIX)).rejects.toThrow(
      m.common_amount_too_large(),
    );
    expect(await db.journalEntries.count()).toBe(0);
    expect(await db.arApEntries.count()).toBe(0);
  });

  test('小数の数量でも売掛金と仕訳の金額は指数表記にならない', async () => {
    const vendorId = await seedVendor();
    const draft = createDraftInvoice('invoice', vendorId, '2026-07-08');
    draft.lineItems = [lineItem({ quantity: '0.0000001', unitPrice: '1' })];

    const issued = await issueInvoice(draft, DEFAULT_INVOICE_PREFIX);

    expect((await db.arApEntries.get(issued.arApEntryId!))?.originalAmount).toBe('0.0000001');
    const lines = await db.journalLines.where('entryId').equals(issued.journalEntryId!).toArray();
    expect(lines.every((l) => !/e/i.test(l.amount))).toBe(true);
  });

  test('見積書を請求書にすると全角・桁区切りの明細が半角に揃う', () => {
    const quote = createDraftInvoice('quote', 'v', '2026-07-08');
    quote.lineItems = [lineItem({ quantity: '１,０００', unitPrice: '２' })];
    const draft = convertQuoteToInvoiceDraft({ ...quote, status: 'issued' }, '2026-07-09');
    expect(draft.lineItems.map((i) => [i.quantity, i.unitPrice])).toEqual([['1000', '2']]);
  });
});

describe('数量・単価の十進の書き方（R7・S13・S14）', () => {
  test.each([
    ['.5', '1000', '550'],
    ['1.', '1000', '1100'],
    ['+5', '1000', '5500'],
    ['1,000.', '100', '110000'],
    ['＋５', '100', '550'],
  ])('数量 %j × 単価 %j は発行でき、合計 %j が仕訳の金額になる', async (q, p, total) => {
    const item = lineItem({ quantity: q, unitPrice: p });
    expect(isLineItemInvalid(item)).toBe(false);
    expect(invoiceTotal([item]).toString()).toBe(total);
    const vendorId = await seedVendor();
    const draft = createDraftInvoice('invoice', vendorId, '2026-07-08');
    draft.lineItems = [item];
    const issued = await issueInvoice(draft, DEFAULT_INVOICE_PREFIX);
    const lines = await db.journalLines.where('entryId').equals(issued.journalEntryId!).toArray();
    expect(lines.find((l) => l.side === 'debit')?.amount).toBe(total);
  });

  test.each(['1e3', '0x10'])('入力 %j は発行できない', (q) => {
    expect(isLineItemInvalid(lineItem({ quantity: q }))).toBe(true);
  });

  test('保存済みの 1e3 の明細は合計を 1000 × 単価で示すが、発行はできない', () => {
    const item = lineItem({ quantity: '1e3', unitPrice: '3' });
    expect(invoiceTotal([item]).toString()).toBe('3300');
    expect(isLineItemInvalid(item)).toBe(true);
  });

  test('100 万桁の数量・単価は 1 秒以内に読めない値になる', () => {
    const long = '0.' + '1'.repeat(1e6);
    const start = Date.now();
    const item = lineItem({ quantity: long, unitPrice: long });
    expect(readInvoiceLineValue(long)).toBeUndefined();
    expect(isLineItemInvalid(item)).toBe(true);
    expect(hasUnreadableLineItems([item])).toBe(true);
    invoiceTotal([item]);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  test('読めない明細のある請求書を見分ける', () => {
    expect(hasUnreadableLineItems([lineItem({ quantity: 'abc' })])).toBe(true);
    expect(hasUnreadableLineItems([lineItem({ quantity: '1e3' })])).toBe(false);
  });

  test('下書きの空欄は読めない値として扱わない', () => {
    expect(hasUnreadableLineItems([lineItem({ unitPrice: '' })])).toBe(false);
    expect(hasUnreadableLineItems([lineItem({ quantity: '' })])).toBe(false);
  });
});
