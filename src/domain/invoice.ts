import { D, Decimal, formatJPY, toAmountString, toIndexable } from '../lib/decimal';
import { normalizeAmountInput, readStoredAmount } from '../lib/amount-input';
import { db } from '../db/db';
import { newId } from '../lib/id';
import { isYearLocked } from './snapshots';
import { reverseEntry } from './reverse';
import type {
  Invoice,
  InvoiceDocumentType,
  InvoiceLineItem,
  JournalEntry,
  JournalLine,
} from '../db/types';
import { m } from '../paraglide/messages';

const RECEIVABLE_ACCOUNT_CODE = '1310'; // 売掛金
const SALES_ACCOUNT_CODE = '4110'; // 売上高

export const DEFAULT_INVOICE_PREFIX = 'INV';
export const DEFAULT_QUOTE_PREFIX = 'QUO';

class InvoiceError extends Error {}

export function newLineItem(): InvoiceLineItem {
  return { id: newId(), name: '', quantity: '1', unitPrice: '0', taxRate: 0.1 };
}

export function createDraftInvoice(
  documentType: InvoiceDocumentType,
  vendorId: string,
  date: string,
): Invoice {
  return {
    id: newId(),
    documentType,
    status: 'draft',
    number: '',
    vendorId,
    date,
    lineItems: [newLineItem()],
    createdAt: Date.now(),
  };
}
// 税率グループ単位の小計・消費税額（インボイス制度の「税率ごとに 1 回だけ端数処理」の原則）。
interface InvoiceTaxGroup {
  taxRate: 0.1 | 0.08;
  subtotalExcl: Decimal;
  taxAmount: Decimal;
  grossAmount: Decimal;
}
// 適格請求書の記載事項には「軽減対象課税資産の譲渡等である旨」が含まれる。
// 8% の明細が 1 行でもあれば、どの行が対象かを書面上で示す必要がある。
export const REDUCED_TAX_RATE = 0.08;

export function hasReducedRateItems(lineItems: InvoiceLineItem[]): boolean {
  return lineItems.some((item) => item.taxRate === REDUCED_TAX_RATE);
}
// 数量・単価に書ける十進の形（.5・1.・+5 を含む）
const LINE_DECIMAL_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
// 明細の値は長くても 64 文字。それより長い値は読む前に断り、画面が固まらないようにする
const LINE_VALUE_MAX_LENGTH = 64;
// 合計・保存・仕訳の金額はすべてこの読み方にそろえる。保存済みの旧い書き方（1e3・0x10）は合計を
// 変えないようそのまま読み、読めない値だけ全角・桁区切り・前後の空白を除いて十進の数として読む
export function readInvoiceLineValue(raw: unknown): Decimal | undefined {
  if (typeof raw === 'string' && raw.length > LINE_VALUE_MAX_LENGTH) {
    return undefined;
  }
  const stored = readStoredAmount(raw);
  if (stored !== undefined || typeof raw !== 'string') {
    return stored;
  }
  const s = normalizeAmountInput(raw);
  return LINE_DECIMAL_PATTERN.test(s) ? readStoredAmount(s) : undefined;
}
// 発行できるのは十進で書かれた値だけ。1e3 や 0x10 は合計には数えるが、発行は止める
export function isLineItemInvalid(item: InvoiceLineItem): boolean {
  return [item.quantity, item.unitPrice].some(
    (v) =>
      typeof v !== 'string' ||
      readInvoiceLineValue(v) === undefined ||
      !LINE_DECIMAL_PATTERN.test(normalizeAmountInput(v)),
  );
}
// 一覧の合計を 0 と見せないよう、読めない明細のある請求書を見分ける。下書きの空欄は合計で 0 と数えるため読める値とする
export function hasUnreadableLineItems(lineItems: readonly InvoiceLineItem[]): boolean {
  const unreadable = (v: unknown) =>
    !(typeof v === 'string' && v.trim() === '') && readInvoiceLineValue(v) === undefined;
  return lineItems.some((item) => unreadable(item.quantity) || unreadable(item.unitPrice));
}
// 発行すると売掛金の仕訳になるため、明細金額の上限（14 桁）を超える請求書は発行できない
export function isInvoiceTotalTooLarge(lineItems: InvoiceLineItem[]): boolean {
  const normalized = normalizeLineItems(lineItems);
  return invoiceTotal(normalized).abs().gte('1e14');
}
// D() が読める値には 1e3 や 0x10 のように揃えると読めなくなる形もあるため、読めない値だけを揃える
export function normalizeLineItems(lineItems: InvoiceLineItem[]): InvoiceLineItem[] {
  return lineItems.map((item) => ({
    ...item,
    quantity: normalizeLineValue(item.quantity),
    unitPrice: normalizeLineValue(item.unitPrice),
  }));
}

function normalizeLineValue(raw: string): string {
  if (readInvoiceLineValue(raw) === undefined || readStoredAmount(raw) !== undefined) {
    return raw;
  }
  return normalizeAmountInput(raw);
}

export function formatUnitPrice(raw: string): string {
  const value = readInvoiceLineValue(raw);
  return value === undefined ? raw : formatJPY(value);
}

export function groupLineItemsByTaxRate(lineItems: InvoiceLineItem[]): InvoiceTaxGroup[] {
  const groups = new Map<0.1 | 0.08, Decimal>();
  for (const item of lineItems) {
    // 編集中の空欄・読めない値で画面全体が落ちないよう 0 として数える（発行は isLineItemInvalid で止める）
    const amount = (readInvoiceLineValue(item.quantity) ?? D(0)).times(
      readInvoiceLineValue(item.unitPrice) ?? D(0),
    );
    groups.set(item.taxRate, (groups.get(item.taxRate) ?? D(0)).plus(amount));
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b - a)
    .map(([taxRate, subtotalExcl]) => {
      const taxAmount = subtotalExcl.times(taxRate).toDecimalPlaces(0, Decimal.ROUND_DOWN);
      return { taxRate, subtotalExcl, taxAmount, grossAmount: subtotalExcl.plus(taxAmount) };
    });
}

export function invoiceTotal(lineItems: InvoiceLineItem[]): Decimal {
  return groupLineItemsByTaxRate(lineItems).reduce((sum, g) => sum.plus(g.grossAmount), D(0));
}

async function nextDocumentNumber(
  documentType: InvoiceDocumentType,
  year: number,
  prefix: string,
): Promise<string> {
  // Dexie の between は既定で上界を含まない。含めないと 12/31 付の文書が件数に入らず、
  // 同じ日に2枚発行すると番号が重複する（適格請求書番号の重複）。
  const issued = await db.invoices
    .where('[documentType+date]')
    .between([documentType, `${year}-01-01`], [documentType, `${year}-12-31`], true, true)
    .and((inv) => inv.status !== 'draft')
    .count();
  return `${prefix}-${year}-${String(issued + 1).padStart(4, '0')}`;
}

function newJournalLine(
  entryId: string,
  side: 'debit' | 'credit',
  accountCode: string,
  amount: Decimal,
  taxRate: number,
  taxIncluded: boolean,
  vendorId: string,
): JournalLine {
  return {
    id: newId(),
    entryId,
    side,
    accountCode,
    vendorId,
    amount: toAmountString(amount),
    amountIndexed: toIndexable(amount),
    taxRate,
    taxIncluded,
    invoiceCompliant: false,
  };
}
// 請求書の発行：仕訳（借方売掛金・貸方売上高、税率グループ別）＋ ArApEntry を生成し、
// 発行済みとして番号確定・ロックする。見積書は仕訳・ArApEntry を生成しない（成立前の提案のため）。
export async function issueInvoice(invoice: Invoice, prefix: string): Promise<Invoice> {
  if (invoice.status !== 'draft') {
    throw new InvoiceError(m.error_invoice_draft_only_issue());
  }
  if (!invoice.vendorId) {
    throw new InvoiceError(m.error_invoice_no_recipient());
  }
  if (invoice.lineItems.length === 0) {
    throw new InvoiceError(m.error_invoice_no_lines());
  }
  const lineItems = normalizeLineItems(invoice.lineItems);
  if (lineItems.some(isLineItemInvalid)) {
    throw new InvoiceError(m.invoices_line_invalid());
  }
  const year = Number(invoice.date.slice(0, 4));
  if (await isYearLocked(year)) {
    throw new InvoiceError(m.error_invoice_year_filed({ year }));
  }

  if (invoice.documentType === 'invoice' && isInvoiceTotalTooLarge(lineItems)) {
    throw new InvoiceError(m.common_amount_too_large());
  }
  const groups = groupLineItemsByTaxRate(lineItems);
  const total = groups.reduce((sum, g) => sum.plus(g.grossAmount), D(0));
  const arApEntryId = newId();
  const now = Date.now();
  const vendorName = (await db.vendors.get(invoice.vendorId))?.name ?? '';
  // 採番と「まだ下書きか」の判定を書き込みと同じトランザクションに入れる。外に出すと
  // 発行ボタンの二度押しで、どちらの呼び出しも古い状態を見て同じ番号を採り、
  // 請求書1件に対して仕訳と売掛金が2件ずつ作られる（voidInvoice は片方しか打ち消せない）。
  // IndexedDB は同一オブジェクトストアのトランザクションを直列化するため、
  // 2度目はここで発行済みの現在値を見て弾かれる。
  await db.transaction(
    'rw',
    db.journalEntries,
    db.journalLines,
    db.arApEntries,
    db.invoices,
    async () => {
      // 未保存の新規下書きは DB に無い。存在する場合だけ現在値で判定する。
      const current = await db.invoices.get(invoice.id);
      if (current && current.status !== 'draft') {
        throw new InvoiceError(m.error_invoice_draft_only_issue());
      }
      const number = await nextDocumentNumber(invoice.documentType, year, prefix);
      if (invoice.documentType === 'quote') {
        await db.invoices.put({ ...invoice, lineItems, status: 'issued', number, issuedAt: now });
        return;
      }
      const entryId = newId();
      const entry: JournalEntry = {
        id: entryId,
        date: invoice.date,
        year,
        description: `${number} ${invoice.memo ?? ''}`.trim(),
        status: 'confirmed',
        source: 'manual',
        createdAt: now,
        confirmedAt: now,
      };
      const lines: JournalLine[] = [
        newJournalLine(
          entryId,
          'debit',
          RECEIVABLE_ACCOUNT_CODE,
          total,
          0,
          false,
          invoice.vendorId,
        ),
        ...groups.map((g) =>
          newJournalLine(
            entryId,
            'credit',
            SALES_ACCOUNT_CODE,
            g.grossAmount,
            g.taxRate,
            true,
            invoice.vendorId,
          ),
        ),
      ];
      await db.journalEntries.add(entry);
      await db.journalLines.bulkAdd(lines);
      await db.arApEntries.add({
        id: arApEntryId,
        type: 'receivable',
        description: vendorName ? `${number}（${vendorName}）` : number,
        dueDate: invoice.dueDate ?? invoice.date,
        originalAmount: toAmountString(total),
        paidAmount: '0',
        createdAt: now,
      });
      await db.invoices.put({
        ...invoice,
        lineItems,
        status: 'issued',
        number,
        issuedAt: now,
        journalEntryId: entryId,
        arApEntryId,
      });
    },
  );

  return (await db.invoices.get(invoice.id))!;
}
// 発行済み文書の取消：journal.ts の打消し仕訳方式を踏襲し、削除して作り直すのではなく
// 打消し仕訳を生成する。既に入金記録がある請求書は消込整合性が崩れるため取消不可。
export async function voidInvoice(invoiceId: string): Promise<void> {
  const invoice = await db.invoices.get(invoiceId);
  if (!invoice) {
    throw new InvoiceError(m.error_invoice_not_found());
  }
  if (invoice.status !== 'issued') {
    throw new InvoiceError(m.error_invoice_issued_only_cancel());
  }

  if (invoice.arApEntryId) {
    const arApEntry = await db.arApEntries.get(invoice.arApEntryId);
    if (arApEntry && D(arApEntry.paidAmount).greaterThan(0)) {
      throw new InvoiceError(m.error_invoice_has_payment());
    }
  }

  if (invoice.journalEntryId) {
    await reverseEntry(invoice.journalEntryId);
  }
  if (invoice.arApEntryId) {
    await db.arApEntries.delete(invoice.arApEntryId);
  }
  await db.invoices.update(invoiceId, { status: 'voided', voidedAt: Date.now() });
}
// 見積書 → 請求書のワンクリック変換：明細をコピーした新規請求書の下書きを作成する。
export function convertQuoteToInvoiceDraft(quote: Invoice, date: string): Invoice {
  if (quote.documentType !== 'quote') {
    throw new InvoiceError(m.error_invoice_quote_only_convert());
  }
  return {
    id: newId(),
    documentType: 'invoice',
    status: 'draft',
    number: '',
    vendorId: quote.vendorId,
    date,
    lineItems: normalizeLineItems(quote.lineItems).map((item) => ({ ...item, id: newId() })),
    ...(quote.memo !== undefined ? { memo: quote.memo } : {}),
    createdAt: Date.now(),
  };
}
