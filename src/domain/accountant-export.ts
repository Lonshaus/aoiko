// 税理士協業・引継ぎパック（C9）。仕訳データを弥生形式CSV／通用CSV／訂正履歴CSVとして出力する。
// PL/BS等の決算書は対象外（仕訳データのみ、C9-2）。
import Encoding from 'encoding-japanese';
import { D, Decimal } from '../lib/decimal';
import { buildCsv } from '../lib/csv';
import { db } from '../db/db';
import { getSetting } from '../lib/settings';
import { countsTowardTotals } from './journal';
import { taxExcludedPortion } from './consumption-tax';
import { transitionalCreditRate } from '../tax-schema/2026/invoice-transitional';
import type {
  Account,
  JournalEntry,
  JournalLine,
  SubAccount,
  TaxCategory,
  TaxFilingMethod,
} from '../db/types';
import type { SimplifiedTaxCategory } from '../tax-schema/2026/simplified-tax';

export function encodeShiftJis(text: string): Uint8Array {
  const unicodeArray = Encoding.stringToCode(text);
  const sjisArray = Encoding.convert(unicodeArray, 'SJIS', 'UNICODE');
  return new Uint8Array(sjisArray);
}
// UTF-8 出力。Excel で直接開いても文字化けしないよう BOM を付与する。
function encodeUtf8WithBom(text: string): Uint8Array {
  return new TextEncoder().encode('﻿' + text);
}

export interface YayoiExportContext {
  taxFilingMethod: TaxFilingMethod;
  simplifiedTaxCategory: SimplifiedTaxCategory;
}

const SIMPLIFIED_KANJI: Record<SimplifiedTaxCategory, string> = {
  1: '一',
  2: '二',
  3: '三',
  4: '四',
  5: '五',
  6: '六',
};

function rateSuffix(taxRate: number): string {
  return taxRate === 0.08 ? '軽減8%' : '10%';
}
// 弥生形式CSVの税区分文字列・税金額を組み立てる。
// 出典：弥生会計サポート情報「インポートデータの税区分」「課税方式別税区分・税計算区分一覧」
// （2026-07 調査時点）。判定の優先順位は consumption-tax.ts の実際の計算ロジックに合わせている
// （taxRate が実質的な判定基準で、taxCategory 未指定でも taxRate > 0 なら通常の課税区分として扱う）。
// 令和8年度改正のインボイス経過措置70%/50%/30%は弥生側の正式な記述形式が未公開のため、
// 確認済みの「区分80%」と同じパターンで外推している（区分{N}%）。弥生が正式な形式を
// 公表したら要見直し（AOIKO_FUTURE_IDEAS.md 未記載、コード内のこの注記のみが根拠）。
function yayoiTaxInfo(
  line: JournalLine,
  account: Account,
  entryDate: string,
  ctx: YayoiExportContext
): { label: string; taxAmount: string } {
  const effectiveTaxCategory: TaxCategory | undefined = line.taxCategory ?? account.taxCategory;

  if (effectiveTaxCategory === 'badDebtRecovery') {
    return {
      label: `課税売回${line.taxIncluded ? '込' : '外'}${rateSuffix(line.taxRate)}`,
      taxAmount: computeTaxAmount(line),
    };
  }

  if (account.category === 'revenue') {
    if (line.taxRate === 0) {
      if (effectiveTaxCategory === 'exportExempt') {
        return { label: '輸出売上', taxAmount: '' };
      }
      if (effectiveTaxCategory === 'exempt') {
        return { label: '非課売上', taxAmount: '' };
      }
      return { label: '対象外', taxAmount: '' };
    }
    const simplifiedSuffix =
      ctx.taxFilingMethod === 'simplified' ? SIMPLIFIED_KANJI[ctx.simplifiedTaxCategory] : '';
    return {
      label: `課税売上${line.taxIncluded ? '込' : '外'}${simplifiedSuffix}${rateSuffix(line.taxRate)}`,
      taxAmount: computeTaxAmount(line),
    };
  }

  // 以下、費用・資産（仕入側）
  if (effectiveTaxCategory === 'importTax10' || effectiveTaxCategory === 'importTax8') {
    // 輸入消費税：金額そのものが税額として扱われる（db/types.ts のコメント参照）
    return { label: '課税対応輸入消費税', taxAmount: D(line.amount).toFixed(0) };
  }
  if (effectiveTaxCategory === 'reverseCharge') {
    // 特定課税仕入れは弥生側の公式手順で「対象外」を指定する運用のため、税額も出力しない
    return { label: '対象外', taxAmount: '' };
  }
  if (effectiveTaxCategory === 'badDebt') {
    return {
      label: `課税売倒${line.taxIncluded ? '込' : '外'}${rateSuffix(line.taxRate)}`,
      taxAmount: computeTaxAmount(line),
    };
  }
  if (line.taxRate === 0) {
    return { label: effectiveTaxCategory === 'exempt' ? '非課仕入' : '対象外', taxAmount: '' };
  }
  const base =
    line.inputUsageCategory === 'common'
      ? '共対仕入'
      : line.inputUsageCategory === 'nonTaxableOnly'
        ? '非対仕入'
        : '課対仕入';
  const invoiceSuffix = line.invoiceCompliant
    ? '適格'
    : `区分${Math.round(transitionalCreditRate(entryDate) * 100)}%`;
  return {
    label: `${base}${line.taxIncluded ? '込' : '外'}${rateSuffix(line.taxRate)}${invoiceSuffix}`,
    taxAmount: computeTaxAmount(line),
  };
}

function computeTaxAmount(line: JournalLine): string {
  if (line.taxRate === 0) {
    return '';
  }
  const amount = D(line.amount);
  const base = taxExcludedPortion(amount, line.taxRate, line.taxIncluded);
  const priceInclusive = line.taxIncluded ? amount : amount.times(1 + line.taxRate);
  return priceInclusive.minus(base).toDecimalPlaces(0, Decimal.ROUND_DOWN).toString();
}

function groupLinesByEntry(lines: JournalLine[]): Map<string, JournalLine[]> {
  const map = new Map<string, JournalLine[]>();
  for (const line of lines) {
    const arr = map.get(line.entryId) ?? [];
    arr.push(line);
    map.set(line.entryId, arr);
  }
  return map;
}
// 弥生形式CSV（25列・識別フラグ2000/2110/2100/2101・Shift-JIS・CRLF想定）の行データを組み立てる。
// 単純な借方1行・貸方1行の仕訳は 2000。複数行ある仕訳のみ振替伝票形式に分割する（C9-3）。
// 訂正済みペア（countsTowardTotals で除外）はここでも除外する。
export function buildYayoiCsvRows(
  entries: JournalEntry[],
  lines: JournalLine[],
  accounts: Account[],
  subAccounts: SubAccount[],
  ctx: YayoiExportContext
): string[][] {
  const accountMap = new Map(accounts.map((a) => [a.code, a]));
  const subAccountMap = new Map(subAccounts.map((s) => [s.id, s.name]));
  const linesByEntry = groupLinesByEntry(lines);
  const rows: string[][] = [];
  let voucherNo = 0;

  for (const entry of entries) {
    if (!countsTowardTotals(entry)) {
      continue;
    }
    const entryLines = linesByEntry.get(entry.id) ?? [];
    const debits = entryLines.filter((l) => l.side === 'debit');
    const credits = entryLines.filter((l) => l.side === 'credit');
    if (debits.length === 0 && credits.length === 0) {
      continue;
    }
    voucherNo++;
    const isSingle = debits.length === 1 && credits.length === 1;
    const rowCount = isSingle ? 1 : Math.max(debits.length, credits.length);

    const buildSide = (line: JournalLine | undefined) => {
      if (!line) {
        return { account: '', sub: '', dept: '', tax: '', amount: '', taxAmount: '' };
      }
      const account = accountMap.get(line.accountCode);
      const info = account
        ? yayoiTaxInfo(line, account, entry.date, ctx)
        : { label: '対象外', taxAmount: '' };
      return {
        account: account?.name ?? line.accountCode,
        sub: line.subAccountId ? (subAccountMap.get(line.subAccountId) ?? '') : '',
        dept: entry.department ?? '',
        tax: info.label,
        amount: D(line.amount).toFixed(0),
        taxAmount: info.taxAmount,
      };
    };

    for (let i = 0; i < rowCount; i++) {
      const flag = isSingle ? '2000' : i === 0 ? '2110' : i === rowCount - 1 ? '2101' : '2100';
      const type = isSingle ? '0' : '3';
      const d = buildSide(debits[i]);
      const c = buildSide(credits[i]);
      rows.push([
        flag,
        String(voucherNo),
        '',
        entry.date.replaceAll('-', '/'),
        d.account,
        d.sub,
        d.dept,
        d.tax,
        d.amount,
        d.taxAmount,
        c.account,
        c.sub,
        c.dept,
        c.tax,
        c.amount,
        c.taxAmount,
        entry.description,
        '',
        '',
        type,
        '',
        '',
        '0',
        '0',
        '',
      ]);
    }
  }
  return rows;
}

const GENERIC_HEADER = [
  '仕訳ID',
  '日付',
  '摘要',
  '部門',
  '貸借',
  '勘定科目コード',
  '勘定科目名',
  '補助科目',
  '金額',
  '税率',
  '税込区分',
  'インボイス適格',
  'メモ',
];
// 通用CSV（UTF-8・JournalLine単位・弥生互換が使えない会計ソフト向けの予備、C9-1）。
export function buildGenericCsvRows(
  entries: JournalEntry[],
  lines: JournalLine[],
  accounts: Account[],
  subAccounts: SubAccount[]
): string[][] {
  const accountMap = new Map(accounts.map((a) => [a.code, a]));
  const subAccountMap = new Map(subAccounts.map((s) => [s.id, s.name]));
  const linesByEntry = groupLinesByEntry(lines);
  const rows: string[][] = [];

  for (const entry of entries) {
    if (!countsTowardTotals(entry)) {
      continue;
    }
    const entryLines = linesByEntry.get(entry.id) ?? [];
    for (const line of entryLines) {
      const account = accountMap.get(line.accountCode);
      rows.push([
        entry.id,
        entry.date,
        entry.description,
        entry.department ?? '',
        line.side === 'debit' ? '借方' : '貸方',
        line.accountCode,
        account?.name ?? line.accountCode,
        line.subAccountId ? (subAccountMap.get(line.subAccountId) ?? '') : '',
        D(line.amount).toFixed(0),
        String(line.taxRate),
        line.taxIncluded ? '税込' : '税抜',
        line.invoiceCompliant ? '適格' : '',
        line.memo ?? '',
      ]);
    }
  }
  return rows;
}

const CORRECTION_HISTORY_HEADER = ['原仕訳日付', '原仕訳摘要', '原仕訳金額', '打消し仕訳日付'];
// 訂正履歴CSV（C9-4/C9-5、方案A）。原仕訳（status='reversed'）と打消し仕訳（reversedByEntryId
// が指す先）の2件のみを出力する「取消履歴」。訂正後の正しい仕訳への構造的なリンクは
// データモデル上存在しないため出力しない（AOIKO_FUTURE_IDEAS.md 参照）。
export function buildCorrectionHistoryRows(
  entries: JournalEntry[],
  lines: JournalLine[]
): string[][] {
  const entryMap = new Map(entries.map((e) => [e.id, e]));
  const linesByEntry = groupLinesByEntry(lines);
  const rows: string[][] = [];

  for (const entry of entries) {
    if (entry.status !== 'reversed' || entry.reversedByEntryId === undefined) {
      continue;
    }
    const reversal = entryMap.get(entry.reversedByEntryId);
    const entryLines = linesByEntry.get(entry.id) ?? [];
    const total = entryLines
      .filter((l) => l.side === 'debit')
      .reduce((sum, l) => sum.plus(l.amount), D(0));
    rows.push([entry.date, entry.description, total.toFixed(0), reversal?.date ?? '']);
  }
  return rows;
}

interface ExportData {
  entries: JournalEntry[];
  lines: JournalLine[];
  accounts: Account[];
  subAccounts: SubAccount[];
  ctx: YayoiExportContext;
}

async function loadExportData(year: number): Promise<ExportData> {
  const entries = await db.journalEntries.where('year').equals(year).toArray();
  const lines =
    entries.length === 0
      ? []
      : await db.journalLines.where('entryId').anyOf(entries.map((e) => e.id)).toArray();
  const accounts = await db.accounts.where({ year }).toArray();
  const subAccounts = await db.subAccounts.toArray();
  const taxFilingMethod = (await getSetting('taxFilingMethod')) ?? 'general';
  const simplifiedTaxCategory = (await getSetting('simplifiedTaxCategory')) ?? 4;
  return {
    entries,
    lines,
    accounts,
    subAccounts,
    ctx: { taxFilingMethod, simplifiedTaxCategory },
  };
}

export async function exportYayoiCsv(year: number): Promise<Uint8Array> {
  const { entries, lines, accounts, subAccounts, ctx } = await loadExportData(year);
  const rows = buildYayoiCsvRows(entries, lines, accounts, subAccounts, ctx);
  return encodeShiftJis(buildCsv(rows));
}

export async function exportGenericCsv(year: number): Promise<Uint8Array> {
  const { entries, lines, accounts, subAccounts } = await loadExportData(year);
  const rows = buildGenericCsvRows(entries, lines, accounts, subAccounts);
  return encodeUtf8WithBom(buildCsv([GENERIC_HEADER, ...rows]));
}

export async function exportCorrectionHistoryCsv(year: number): Promise<Uint8Array> {
  const entries = await db.journalEntries.where('year').equals(year).toArray();
  const lines =
    entries.length === 0
      ? []
      : await db.journalLines.where('entryId').anyOf(entries.map((e) => e.id)).toArray();
  const rows = buildCorrectionHistoryRows(entries, lines);
  return encodeUtf8WithBom(buildCsv([CORRECTION_HISTORY_HEADER, ...rows]));
}