import { D, Decimal, toIndexable } from '../lib/decimal';
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

export function groupLineItemsByTaxRate(lineItems: InvoiceLineItem[]): InvoiceTaxGroup[] {
  const groups = new Map<0.1 | 0.08, Decimal>();
  for (const item of lineItems) {
    const amount = D(item.quantity).times(item.unitPrice);
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
    amount: amount.toString(),
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
  const year = Number(invoice.date.slice(0, 4));
  if (await isYearLocked(year)) {
    throw new InvoiceError(m.error_invoice_year_filed({ year }));
  }

  const groups = groupLineItemsByTaxRate(invoice.lineItems);
  const total = groups.reduce((sum, g) => sum.plus(g.grossAmount), D(0));
  const arApEntryId = newId();
  const now = Date.now();
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
        await db.invoices.put({ ...invoice, status: 'issued', number, issuedAt: now });
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
        description: `${number}（${invoice.vendorId}）`,
        dueDate: invoice.dueDate ?? invoice.date,
        originalAmount: total.toString(),
        paidAmount: '0',
        createdAt: now,
      });
      await db.invoices.put({
        ...invoice,
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
      throw new InvoiceError(
        '入金記録がある請求書は取消できません。先に入金記録を取り消してください',
      );
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
    lineItems: quote.lineItems.map((item) => ({ ...item, id: newId() })),
    ...(quote.memo !== undefined ? { memo: quote.memo } : {}),
    createdAt: Date.now(),
  };
}
