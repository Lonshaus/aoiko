import { db } from '../db/db';
import { D, type Decimal } from '../lib/decimal';
import { readStoredAmount } from '../lib/amount-input';
import { countsTowardTotals } from './journal';
import type { JournalEntry, JournalLine } from '../db/types';
import { m } from '../paraglide/messages';

const LIST_LIMIT = 20;
const ECHO_LIMIT = 40;
const MAX_NON_PLAIN_LENGTH = 64;

export interface FoundAmount {
  kind: 'line' | 'asset';
  date: string;
  // 仕訳の摘要、または固定資産の名前
  description: string;
  // 先頭 40 文字だけ。巨大な値も toFixed せずに示す
  amount: string;
}

export interface FoundAmounts {
  items: FoundAmount[];
  total: number;
}
// 復元時の検証は 1e14 以上の明細を形式だけ見て通す。そうした明細は .xtx の 15 桁にも
// 仕訳の索引の 14 桁にも収まらないため、ここで洗い出して訂正仕訳での取り消しを促す
type AmountProblem = 'unreadable' | 'too-large' | undefined;

function lineAmountProblem(amount: unknown, includeLarge: boolean): AmountProblem {
  if (typeof amount !== 'string') {
    return 'unreadable';
  }
  if (!/^\d+(\.\d+)?$/.test(amount) && amount.length > MAX_NON_PLAIN_LENGTH) {
    return 'unreadable';
  }
  let d: Decimal;
  try {
    d = D(amount);
  } catch {
    return 'unreadable';
  }
  if (!d.isFinite() || !(d.e >= -1000 && d.e <= 1000)) {
    return 'unreadable';
  }
  return includeLarge && d.abs().gte('1e14') ? 'too-large' : undefined;
}

function echo(v: unknown): string {
  return String(v).slice(0, ECHO_LIMIT);
}

function scanLines(
  entries: readonly JournalEntry[],
  lines: readonly JournalLine[],
  includeLarge: boolean,
  found: FoundAmount[],
): void {
  const entryById = new Map(entries.map((e) => [e.id, e]));
  for (const line of lines) {
    const entry = entryById.get(line.entryId);
    if (!entry) {
      continue;
    }
    // 課税資産の譲渡等の対価も消費税の計算と会計士向け CSV が金額として読む
    const consideration = line.taxableTransferConsideration;
    for (const amount of consideration === undefined
      ? [line.amount]
      : [line.amount, consideration]) {
      if (lineAmountProblem(amount, includeLarge) === undefined) {
        continue;
      }
      found.push({
        kind: 'line',
        date: entry.date,
        description: entry.description,
        amount: echo(amount),
      });
    }
  }
}

async function loadLines(entries: readonly JournalEntry[]): Promise<JournalLine[]> {
  if (entries.length === 0) {
    return [];
  }
  return db.journalLines
    .where('entryId')
    .anyOf(entries.map((e) => e.id))
    .toArray();
}

function limited(found: FoundAmount[]): FoundAmounts {
  return { items: found.slice(0, LIST_LIMIT), total: found.length };
}
// 集計に入る仕訳（訂正で打ち消したものは除く）の 1e14 以上・読めない明細と、取得価額が 1e14 以上の固定資産。
// year を渡すとその年度の仕訳だけを見る。値が壊れていても投げない
export async function findOversizedAmounts(options: { year?: number } = {}): Promise<FoundAmounts> {
  const all =
    options.year === undefined
      ? await db.journalEntries.toArray()
      : await db.journalEntries.where('year').equals(options.year).toArray();
  const entries = all.filter(countsTowardTotals);
  const found: FoundAmount[] = [];
  scanLines(entries, await loadLines(entries), true, found);
  for (const asset of await db.fixedAssets.toArray()) {
    const cost = readStoredAmount(asset.acquisitionCost);
    if (cost !== undefined && cost.abs().gte('1e14')) {
      found.push({
        kind: 'asset',
        date: String(asset.acquisitionDate),
        description: String(asset.name),
        amount: echo(asset.acquisitionCost),
      });
    }
  }
  return limited(found);
}
// 訂正履歴 CSV は打ち消し済みの原仕訳を出力する。1e14 以上は toFixed(0) で出せるので止めず、読めない明細だけを返す
export async function findUnreadableReversedAmounts(year: number): Promise<FoundAmounts> {
  const entries = (await db.journalEntries.where('year').equals(year).toArray()).filter(
    (e) => e.status === 'reversed',
  );
  const found: FoundAmount[] = [];
  scanLines(entries, await loadLines(entries), false, found);
  return limited(found);
}

function describeItem(item: FoundAmount): string {
  return item.kind === 'asset'
    ? m.oversized_amounts_item_asset({ name: item.description, amount: item.amount })
    : m.oversized_amounts_item_line({
        date: item.date,
        description: item.description,
        amount: item.amount,
      });
}

export function describeFoundAmounts(
  found: FoundAmounts,
  kind: 'oversized' | 'unreadable' = 'oversized',
): string {
  const items = found.items.map(describeItem).join(' / ');
  return kind === 'unreadable'
    ? m.reversed_amounts_unreadable({ count: found.total, items })
    : m.oversized_amounts_found({ count: found.total, items });
}

export class OversizedAmountsError extends Error {
  constructor(found: FoundAmounts, kind: 'oversized' | 'unreadable' = 'oversized') {
    super(describeFoundAmounts(found, kind));
    this.name = 'OversizedAmountsError';
  }
}
