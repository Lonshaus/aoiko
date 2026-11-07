// 税理士協業・引継ぎパック。仕訳データを弥生形式CSV／汎用CSV／訂正履歴CSVとして出力する。
// PL/BS等の決算書は対象外（仕訳データのみ、C9-2）。
import Encoding from 'encoding-japanese';
import { D, Decimal } from '../lib/decimal';
import { buildCsv, neutralizeFormula } from '../lib/csv';
import { db } from '../db/db';
import { loadAccountsForYear } from '../db/year-accounts';
import { getSetting, loadSmallAmountSpecialInputs } from '../lib/settings';
import { isProcessingYear } from '../lib/initial-processing-year';
import { countsTowardTotals } from './journal';
import { usesLegacyPurchaseAssetRule } from './snapshots';
import {
  classifyNonInvoicePurchases,
  countsAsPurchaseInput,
  taxExcludedPortion,
  type SmallAmountSpecialInputs,
} from './consumption-tax';
import { transitionalCreditRate } from '../tax-schema/2026/invoice-transitional';
import { DEPRECIABLE_ASSET_ACCOUNTS } from '../tax-schema/2026/accounts';
import type {
  Account,
  FixedAsset,
  JournalEntry,
  JournalLine,
  SubAccount,
  TaxCategory,
  TaxFilingMethod,
} from '../db/types';
import type { SimplifiedTaxCategory } from '../tax-schema/2026/simplified-tax';

export function encodeShiftJis(text: string): Uint8Array<ArrayBuffer> {
  const unicodeArray = Encoding.stringToCode(text);
  const sjisArray = Encoding.convert(unicodeArray, 'SJIS', 'UNICODE');
  return new Uint8Array(sjisArray);
}
// UTF-8 出力。Excel で直接開いても文字化けしないよう BOM を付与する。
function encodeUtf8WithBom(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode('﻿' + text);
}

interface YayoiExportContext {
  taxFilingMethod: TaxFilingMethod;
  simplifiedTaxCategory: SimplifiedTaxCategory;
  smallAmountSpecial?: SmallAmountSpecialInputs;
  /** 仕訳 id → 売却した資産の科目コード */
  saleAssetAccounts?: ReadonlyMap<string, string>;
  /** 申告済みの年分で、現金預金・金銭債権の借方も仕入に含めていた時期の判定で出す */
  legacyPurchaseAssets?: boolean;
  omitDepartment?: boolean;
}

interface YayoiSideCell {
  account: string;
  sub: string;
  dept: string;
  tax: string;
  amount: string;
  taxAmount: string;
}

const OWNER_CONTRIBUTION_CODE = '3120';
const SALE_DESCRIPTION_PREFIX = '固定資産売却 ';
const DEPRECIABLE_ASSET_CODES = new Set(DEPRECIABLE_ASSET_ACCOUNTS.map((a) => a.code));
// やよいの青色申告 オンラインは科目名の 10 文字を超える部分を切り捨てるため、弥生形式でだけ短くする
const YAYOI_ACCOUNT_NAMES: ReadonlyMap<string, string> = new Map([
  ['5810', '貸倒引当金繰入一括'],
  ['5811', '貸倒引当金繰入個別'],
  ['5410', '貸倒引当金繰入不動産'],
  ['4230', '貸倒引当金繰戻不動産'],
  ['4220', '礼金・権利金等不動産'],
]);
const YAYOI_NAME_COLUMNS = [4, 5, 6, 10, 11, 12];

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
// 簡易課税の税区分一覧（18111・27165）には用途区分が無く、課対仕入・課対輸税だけが載っている
function usagePrefix(line: JournalLine, ctx: YayoiExportContext): '課対' | '共対' | '非対' {
  if (ctx.taxFilingMethod === 'simplified') {
    return '課対';
  }
  if (line.inputUsageCategory === 'common') {
    return '共対';
  }
  if (line.inputUsageCategory === 'nonTaxableOnly') {
    return '非対';
  }
  return '課対';
}
// 弥生形式CSVの税区分文字列・税金額を組み立てる。
// 出典：弥生会計サポート情報「インポートデータの税区分」「課税方式別税区分・税計算区分一覧」
// （2026-07 調査時点）。判定の優先順位は consumption-tax.ts の実際の計算ロジックに合わせている
// （taxRate が実質的な判定基準で、taxCategory 未指定でも taxRate > 0 なら通常の課税区分として扱う）。
// 「区分」接尾辞は弥生公式サポート（page_id=18111・27165）が100%/80%/70%/50%/30%/控不のみを規定。
function yayoiTaxInfo(
  line: JournalLine,
  account: Account,
  entryDate: string,
  ctx: YayoiExportContext,
  capExceeded = false,
): { label: string; taxAmount: string } {
  // 課税資産の譲渡等の行単位の印：収入科目ならこの行自体が課税売上行になる（対価は
  // taxableTransferConsideration を使う）。それ以外の科目は別途合成する売上行に譲るため
  // 対象外にする（呼出元 buildYayoiCsvRows が同科目の合成ペアを追加する）
  if (line.taxableTransferConsideration !== undefined) {
    if (account.category === 'revenue') {
      return markedTransferTaxInfo(line, ctx);
    }
    return { label: '対象外', taxAmount: '' };
  }
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
    // 弥生の入力例（29507）では国税分の行の税額欄が空欄
    const rate = effectiveTaxCategory === 'importTax10' ? '7.8%' : '軽減6.24%';
    return { label: `${usagePrefix(line, ctx)}輸税${rate}`, taxAmount: '' };
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
  if (line.taxRate === 0 || !countsAsPurchaseInput(line, account, ctx.legacyPurchaseAssets)) {
    return { label: '対象外', taxAmount: '' };
  }
  const base = `${usagePrefix(line, ctx)}仕入`;
  // 控除上限（附則52条1項）を超えた取引先の行、経過措置終了後（令和13年10月以後）の行は
  // 控除できないため「区分控不」にする
  const creditRate = capExceeded ? 0 : transitionalCreditRate(entryDate);
  const invoiceSuffix = line.invoiceCompliant
    ? '適格'
    : creditRate === 0
      ? '区分控不'
      : `区分${Math.round(creditRate * 100)}%`;
  return {
    label: `${base}${line.taxIncluded ? '込' : '外'}${rateSuffix(line.taxRate)}${invoiceSuffix}`,
    taxAmount: computeTaxAmount(line),
  };
}
// taxableTransferConsideration の行の課税売上区分（簡易課税時は消基通13-2-9で第四種）。
// 込／外・税率は行の taxIncluded・taxRate に従う（通常の売上行と同じ規約）
function markedTransferTaxInfo(
  line: JournalLine,
  ctx: YayoiExportContext,
): { label: string; taxAmount: string } {
  const consideration = D(line.taxableTransferConsideration ?? '0');
  const simplifiedSuffix = ctx.taxFilingMethod === 'simplified' ? SIMPLIFIED_KANJI[4] : '';
  return {
    label: `課税売上${line.taxIncluded ? '込' : '外'}${simplifiedSuffix}${rateSuffix(line.taxRate)}`,
    taxAmount: considerationTaxAmount(consideration, line.taxRate, line.taxIncluded),
  };
}

function considerationTaxAmount(amount: Decimal, taxRate: number, taxIncluded: boolean): string {
  if (taxRate === 0) {
    return '';
  }
  const base = taxExcludedPortion(amount, taxRate, taxIncluded);
  const priceInclusive = taxIncluded ? amount : amount.times(1 + taxRate);
  return priceInclusive.minus(base).toDecimalPlaces(0, Decimal.ROUND_DOWN).toString();
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
// 超過部分を含む行は1行の中で按分できないため、行全体を控除不可の区分で出す
function capExceededLineIds(
  entries: JournalEntry[],
  lines: JournalLine[],
  accountMap: ReadonlyMap<string, Account>,
  smallAmountSpecial: SmallAmountSpecialInputs = {},
  legacy = false,
): Set<string> {
  const counted = entries.filter((e) => countsTowardTotals(e));
  const result = new Set<string>();
  for (const year of new Set(counted.map((e) => e.year))) {
    const entryDateMap = new Map(counted.filter((e) => e.year === year).map((e) => [e.id, e.date]));
    const yearLines = lines.filter((l) => entryDateMap.has(l.entryId));
    const { capExcess } = classifyNonInvoicePurchases(
      year,
      entryDateMap,
      yearLines,
      accountMap,
      smallAmountSpecial,
      legacy,
    );
    for (const lineId of capExcess.keys()) {
      result.add(lineId);
    }
  }
  return result;
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
// 単純な借方1行・貸方1行の仕訳は 2000。複数行ある仕訳のみ振替伝票形式に分割する。
// 訂正済みペア（countsTowardTotals で除外）はここでも除外する。
export function buildYayoiCsvRows(
  entries: JournalEntry[],
  lines: JournalLine[],
  accounts: Account[],
  subAccounts: SubAccount[],
  ctx: YayoiExportContext,
): string[][] {
  return buildYayoiEntryRows(entries, lines, accounts, subAccounts, ctx).flatMap((g) => g.rows);
}

interface YayoiEntryRows {
  entry: JournalEntry;
  lines: JournalLine[];
  rows: string[][];
  transferWithoutAsset: boolean;
  legacyPurchase: boolean;
}

function yayoiCell(value: string): string {
  return value
    .replaceAll(',', '，')
    .replaceAll('"', '”')
    .replaceAll(';', '；')
    .replace(/[\r\n\t]/g, ' ');
}

function yayoiAccountName(account: Account | undefined, code: string): string {
  if (account === undefined) {
    return code;
  }
  return YAYOI_ACCOUNT_NAMES.get(account.code) ?? account.name;
}

function buildYayoiEntryRows(
  entries: JournalEntry[],
  lines: JournalLine[],
  accounts: Account[],
  subAccounts: SubAccount[],
  ctx: YayoiExportContext,
): YayoiEntryRows[] {
  const accountMap = new Map(accounts.map((a) => [a.code, a]));
  const subAccountMap = new Map(subAccounts.map((s) => [s.id, s.name]));
  const linesByEntry = groupLinesByEntry(lines);
  const legacy = ctx.legacyPurchaseAssets === true;
  const capExceeded = capExceededLineIds(
    entries,
    lines,
    accountMap,
    ctx.smallAmountSpecial,
    legacy,
  );
  // 申告時の判定で出す年分は、今の判定と税区分が変わる行を知らせるため、今の判定でも組み立てる
  const currentRule = legacy
    ? {
        ctx: { ...ctx, legacyPurchaseAssets: false },
        capExceeded: capExceededLineIds(entries, lines, accountMap, ctx.smallAmountSpecial),
      }
    : undefined;
  const groups: YayoiEntryRows[] = [];
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
    let transferWithoutAsset = false;
    const department = ctx.omitDepartment === true ? '' : (entry.department ?? '');

    const buildSide = (line: JournalLine): YayoiSideCell => {
      const account = accountMap.get(line.accountCode);
      const info = account
        ? yayoiTaxInfo(line, account, entry.date, ctx, capExceeded.has(line.id))
        : { label: '対象外', taxAmount: '' };
      return {
        account: yayoiAccountName(account, line.accountCode),
        sub: line.subAccountId ? (subAccountMap.get(line.subAccountId) ?? '') : '',
        dept: department,
        tax: info.label,
        amount: D(line.amount).toFixed(0),
        taxAmount: info.taxAmount,
      };
    };
    const debitCells = debits.map(buildSide);
    const creditCells = credits.map(buildSide);
    const legacyPurchase =
      currentRule !== undefined &&
      entryLines.some((line) => {
        const account = accountMap.get(line.accountCode);
        if (account === undefined) {
          return false;
        }
        const filed = yayoiTaxInfo(line, account, entry.date, ctx, capExceeded.has(line.id));
        const current = yayoiTaxInfo(
          line,
          account,
          entry.date,
          currentRule.ctx,
          currentRule.capExceeded.has(line.id),
        );
        return filed.label !== current.label;
      });
    // 課税資産の譲渡等の行単位の印：収入科目でない行は本来の貸借だけでは課税売上を表現
    // できないため、印の付いた行自身の科目で対価分の合成ペア（貸方＝課税売上、借方＝対象外）
    // を追加する。両側とも同額のため元の仕訳の貸借バランスは変わらない
    for (const line of entryLines) {
      if (line.taxableTransferConsideration === undefined) {
        continue;
      }
      const account = accountMap.get(line.accountCode);
      if (account?.category === 'revenue') {
        continue;
      }
      let target = account;
      // 弥生の売却の記帳例は課税売上を資産科目に付けるため、事業主借の行は売却した資産の科目で合成する
      if (line.accountCode === OWNER_CONTRIBUTION_CODE) {
        const assetCode = ctx.saleAssetAccounts?.get(entry.id);
        const assetAccount = assetCode === undefined ? undefined : accountMap.get(assetCode);
        if (assetAccount === undefined) {
          transferWithoutAsset = true;
        } else {
          target = assetAccount;
        }
      }
      const info = markedTransferTaxInfo(line, ctx);
      const amount = D(line.taxableTransferConsideration).toFixed(0);
      const accountName = yayoiAccountName(target, line.accountCode);
      creditCells.push({
        account: accountName,
        sub: '',
        dept: department,
        tax: info.label,
        amount,
        taxAmount: info.taxAmount,
      });
      debitCells.push({
        account: accountName,
        sub: '',
        dept: department,
        tax: '対象外',
        amount,
        taxAmount: '',
      });
    }

    const isSingle = debitCells.length === 1 && creditCells.length === 1;
    const rowCount = isSingle ? 1 : Math.max(debitCells.length, creditCells.length);
    const emptyCell: YayoiSideCell = {
      account: '',
      sub: '',
      dept: '',
      tax: '対象外',
      amount: '0',
      taxAmount: '',
    };
    const rows: string[][] = [];
    for (let i = 0; i < rowCount; i++) {
      const flag = isSingle ? '2000' : i === 0 ? '2110' : i === rowCount - 1 ? '2101' : '2100';
      const type = isSingle ? '0' : '3';
      const d = debitCells[i] ?? emptyCell;
      const c = creditCells[i] ?? emptyCell;
      const cells = [
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
      ];
      // 弥生は先頭・末尾に空白やタブのある名前を受け付けない（26726）
      rows.push(
        cells.map((cell, col) =>
          YAYOI_NAME_COLUMNS.includes(col) ? yayoiCell(cell).trim() : yayoiCell(cell),
        ),
      );
    }
    groups.push({ entry, lines: entryLines, rows, transferWithoutAsset, legacyPurchase });
  }
  return groups;
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
// 汎用CSV（UTF-8・JournalLine単位・弥生互換が使えない会計ソフト向けの予備、C9-1）。
export function buildGenericCsvRows(
  entries: JournalEntry[],
  lines: JournalLine[],
  accounts: Account[],
  subAccounts: SubAccount[],
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
// 訂正履歴CSV。原仕訳（status='reversed'）と打消し仕訳（reversedByEntryId
// が指す先）の2件のみを出力する「取消履歴」。訂正後の正しい仕訳への構造的なリンクは
// データモデル上存在しないため出力しない。
export function buildCorrectionHistoryRows(
  entries: JournalEntry[],
  lines: JournalLine[],
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
// generateDisposalEntry が付けた摘要（`固定資産売却 ${name} #${id の先頭 8 文字}`）から資産を引く。
// 名前にも同じ形の文字列が入りうるため末尾で照合し、1 件に決まらないものは使わない
function findSaleAssetAccounts(
  entries: JournalEntry[],
  assets: FixedAsset[],
  accounts: Account[],
): Map<string, string> {
  const yearCodes = new Set(accounts.map((a) => a.code));
  const result = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.description.startsWith(SALE_DESCRIPTION_PREFIX)) {
      continue;
    }
    const matched = assets.filter((a) => entry.description.endsWith(` #${a.id.slice(0, 8)}`));
    const [asset] = matched;
    if (matched.length !== 1 || asset === undefined) {
      continue;
    }
    if (DEPRECIABLE_ASSET_CODES.has(asset.accountCode) && yearCodes.has(asset.accountCode)) {
      result.set(entry.id, asset.accountCode);
    }
  }
  return result;
}

async function loadExportData(year: number): Promise<ExportData> {
  const entries = await db.journalEntries.where('year').equals(year).toArray();
  const lines =
    entries.length === 0
      ? []
      : await db.journalLines
          .where('entryId')
          .anyOf(entries.map((e) => e.id))
          .toArray();
  const accounts = await loadAccountsForYear(year);
  const subAccounts = await db.subAccounts.toArray();
  const taxFilingMethod = (await getSetting('taxFilingMethod')) ?? 'general';
  const simplifiedTaxCategory = (await getSetting('simplifiedTaxCategory')) ?? 4;
  const smallAmountSpecial = await loadSmallAmountSpecialInputs();
  const assets = await db.fixedAssets.toArray();
  const saleAssetAccounts = findSaleAssetAccounts(entries, assets, accounts);
  const legacyPurchaseAssets = await usesLegacyPurchaseAssetRule(year);
  return {
    entries,
    lines,
    accounts,
    subAccounts,
    ctx: {
      taxFilingMethod,
      simplifiedTaxCategory,
      smallAmountSpecial,
      saleAssetAccounts,
      legacyPurchaseAssets,
    },
  };
}

export async function exportYayoiCsv(year: number): Promise<Uint8Array<ArrayBuffer>> {
  const { entries, lines, accounts, subAccounts, ctx } = await loadExportData(year);
  const rows = buildYayoiCsvRows(entries, lines, accounts, subAccounts, ctx);
  return encodeShiftJis(buildCsv(rows));
}

export type YayoiNoticeReason =
  'rows' | 'capital' | 'amount' | 'transfer' | 'legacyPurchase' | 'length';

export interface YayoiExportNotice {
  date: string;
  description: string;
  rows: number;
  reasons: YayoiNoticeReason[];
}

export interface YayoiCsvParts {
  parts: Uint8Array<ArrayBuffer>[];
  notices: YayoiExportNotice[];
}

const YAYOI_MAX_ROWS_PER_FILE = 1000;
// 「1.0MB」が 1,000,000 と 1,048,576 のどちらを指すか読み取れないため、小さい方に合わせる
const YAYOI_MAX_BYTES_PER_FILE = 1_000_000;
const YAYOI_MAX_ROWS_PER_ENTRY = 20;
const YAYOI_MAX_AMOUNT = D('999999999');
const CAPITAL_CODE = '3110';
const YAYOI_AMOUNT_COLUMNS = [8, 9, 14, 15];
const YAYOI_MAX_NAME_BYTES = 24;
// オンラインは科目 10 文字（やよいの青色申告、27183）・補助科目 15 文字を超える部分を切り捨てる
const YAYOI_ONLINE_MAX_NAME_CHARS: ReadonlyMap<number, number> = new Map([
  [4, 10],
  [10, 10],
  [5, 15],
  [11, 15],
]);
// 書き出す値は buildCsv が付ける ' を含むため、付けた後の値で測る
function yayoiNameTooLong(row: string[]): boolean {
  return YAYOI_NAME_COLUMNS.some((col) => {
    const value = neutralizeFormula(row[col] ?? '');
    const maxChars = YAYOI_ONLINE_MAX_NAME_CHARS.get(col);
    return (
      encodeShiftJis(value).length > YAYOI_MAX_NAME_BYTES ||
      (maxChars !== undefined && [...value].length > maxChars)
    );
  });
}

function yayoiNotice(group: YayoiEntryRows): YayoiExportNotice | undefined {
  const reasons: YayoiNoticeReason[] = [];
  if (group.rows.length > YAYOI_MAX_ROWS_PER_ENTRY) {
    reasons.push('rows');
  }
  if (group.lines.some((l) => l.accountCode === CAPITAL_CODE)) {
    reasons.push('capital');
  }
  const overAmount = group.rows.some((row) =>
    YAYOI_AMOUNT_COLUMNS.some((col) => {
      const cell = row[col] ?? '';
      return cell !== '' && D(cell).abs().greaterThan(YAYOI_MAX_AMOUNT);
    }),
  );
  if (overAmount) {
    reasons.push('amount');
  }
  if (group.transferWithoutAsset) {
    reasons.push('transfer');
  }
  if (group.legacyPurchase) {
    reasons.push('legacyPurchase');
  }
  if (group.rows.some(yayoiNameTooLong)) {
    reasons.push('length');
  }
  if (reasons.length === 0) {
    return undefined;
  }
  return {
    date: group.entry.date,
    description: group.entry.description,
    rows: group.rows.length,
    reasons,
  };
}

export async function exportYayoiCsvParts(
  year: number,
  options: { includeDepartment?: boolean } = {},
): Promise<YayoiCsvParts> {
  const { entries, lines, accounts, subAccounts, ctx } = await loadExportData(year);
  // スタンダードとやよいの青色申告は部門を取り込めないため、選ばれたときだけ書き出す
  const groups = buildYayoiEntryRows(entries, lines, accounts, subAccounts, {
    ...ctx,
    omitDepartment: options.includeDepartment !== true,
  });
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let current: string[][] = [];
  let currentBytes = 0;
  const flush = (): void => {
    if (current.length > 0) {
      parts.push(encodeShiftJis(buildCsv(current)));
      current = [];
      currentBytes = 0;
    }
  };
  // 1 件の仕訳を 2 つのファイルに分けると、どちらのファイルも貸借が合わなくなるため分けない
  for (const group of groups) {
    const groupBytes = group.rows.reduce(
      (sum, row) => sum + encodeShiftJis(buildCsv([row])).length,
      0,
    );
    if (
      current.length + group.rows.length > YAYOI_MAX_ROWS_PER_FILE ||
      currentBytes + groupBytes > YAYOI_MAX_BYTES_PER_FILE
    ) {
      flush();
    }
    current.push(...group.rows);
    currentBytes += groupBytes;
  }
  flush();
  const notices = groups.map(yayoiNotice).filter((n): n is YayoiExportNotice => n !== undefined);
  return { parts, notices };
}

export async function exportGenericCsv(year: number): Promise<Uint8Array<ArrayBuffer>> {
  const { entries, lines, accounts, subAccounts } = await loadExportData(year);
  const rows = buildGenericCsvRows(entries, lines, accounts, subAccounts);
  return encodeUtf8WithBom(buildCsv([GENERIC_HEADER, ...rows]));
}

// 年度が処理年度の範囲外の原仕訳は、どの年度の CSV にも載らないため打消し仕訳の年度に載せる。
async function loadOutOfRangeOriginals(entries: JournalEntry[]): Promise<JournalEntry[]> {
  const inEntries = new Set(entries.map((e) => e.id));
  const firstReversalAt = new Map<string, number>();
  for (const e of entries) {
    if (e.originalEntryId === undefined || inEntries.has(e.originalEntryId)) {
      continue;
    }
    const prev = firstReversalAt.get(e.originalEntryId);
    if (prev === undefined || e.createdAt < prev) {
      firstReversalAt.set(e.originalEntryId, e.createdAt);
    }
  }
  if (firstReversalAt.size === 0) {
    return [];
  }
  const found = await db.journalEntries.bulkGet([...firstReversalAt.keys()]);
  return found
    .filter(
      (e): e is JournalEntry =>
        e !== undefined && e.status === 'reversed' && !isProcessingYear(e.year),
    )
    .sort((a, b) => (firstReversalAt.get(a.id) ?? 0) - (firstReversalAt.get(b.id) ?? 0));
}
// 打消し仕訳が別の年度にある原仕訳の日付を引くためだけに読む。行を作らないよう訂正済みのものは除く。
async function loadReversalsForDate(
  originals: JournalEntry[],
  entries: JournalEntry[],
): Promise<JournalEntry[]> {
  const inEntries = new Set(entries.map((e) => e.id));
  const ids = new Set<string>();
  for (const e of originals) {
    if (
      e.status === 'reversed' &&
      e.reversedByEntryId !== undefined &&
      !inEntries.has(e.reversedByEntryId)
    ) {
      ids.add(e.reversedByEntryId);
    }
  }
  if (ids.size === 0) {
    return [];
  }
  const found = await db.journalEntries.bulkGet([...ids]);
  return found.filter((e): e is JournalEntry => e !== undefined && e.status !== 'reversed');
}

export async function exportCorrectionHistoryCsv(year: number): Promise<Uint8Array<ArrayBuffer>> {
  const entries = await db.journalEntries.where('year').equals(year).toArray();
  const extraOriginals = isProcessingYear(year) ? await loadOutOfRangeOriginals(entries) : [];
  const listed = [...entries, ...extraOriginals];
  const reversalsForDate = await loadReversalsForDate(listed, entries);
  const lines =
    listed.length === 0
      ? []
      : await db.journalLines
          .where('entryId')
          .anyOf(listed.map((e) => e.id))
          .toArray();
  const rows = buildCorrectionHistoryRows([...listed, ...reversalsForDate], lines);
  return encodeUtf8WithBom(buildCsv([CORRECTION_HISTORY_HEADER, ...rows]));
}
