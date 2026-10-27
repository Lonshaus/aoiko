import { db } from '../db/db';
import { D, type Decimal, toAmountString } from '../lib/decimal';
import { newId } from '../lib/id';
import { isValidIsoDate } from '../lib/date';
import { parseAmountInput, readStoredAmount } from '../lib/amount-input';
import type { ArApEntry, ArApType } from '../db/types';
import { m } from '../paraglide/messages';
// 復元された補助簿は金額を検査していないため、読めない行は undefined を返し表全体を巻き込まない
export function remainingBalance(entry: ArApEntry): Decimal | undefined {
  const original = readStoredAmount(entry.originalAmount);
  const paid = readStoredAmount(entry.paidAmount);
  if (original === undefined || paid === undefined) {
    return undefined;
  }
  return original.minus(paid);
}

export async function addArApEntry(input: {
  type: ArApType;
  description: string;
  dueDate: string;
  originalAmount: string;
}): Promise<void> {
  await db.arApEntries.add({
    id: newId(),
    type: input.type,
    description: input.description,
    dueDate: input.dueDate,
    originalAmount: input.originalAmount,
    paidAmount: '0',
    createdAt: Date.now(),
  });
}
// 入金・支払の一部/全部消込。残高を超える額は例外を投げる（過収受・過払いは別の記帳で扱う想定、
// ここでは単純な補助簿の整合性のみ担保する）。
export class OverpaymentError extends Error {
  constructor() {
    super('残高を超える金額です');
    this.name = 'OverpaymentError';
  }
}
// 負の額は消込ではなく残高を増やす操作になり、補助簿の整合性が崩れる
export class InvalidPaymentAmountError extends Error {
  constructor() {
    super(m.common_amount_invalid());
    this.name = 'InvalidPaymentAmountError';
  }
}

export async function recordPayment(id: string, amount: string): Promise<void> {
  const paid = parseAmountInput(amount);
  if (paid === undefined) {
    throw new InvalidPaymentAmountError();
  }
  const entry = await db.arApEntries.get(id);
  if (!entry) {
    throw new Error(m.error_receivable_not_found());
  }
  const original = readStoredAmount(entry.originalAmount);
  const alreadyPaid = readStoredAmount(entry.paidAmount);
  if (original === undefined || alreadyPaid === undefined) {
    throw new Error(m.error_arap_amount_unreadable({ description: entry.description }));
  }
  const newPaid = alreadyPaid.plus(paid);
  if (newPaid.greaterThan(original)) {
    throw new OverpaymentError();
  }
  await db.arApEntries.update(id, { paidAmount: toAmountString(newPaid) });
}

interface CashFlowMonthBucket {
  yearMonth: string; // 'YYYY-MM'
  expectedInflow: string;
  expectedOutflow: string;
  netChange: string;
}

export interface CashFlowForecast {
  asOfDate: string;
  months: CashFlowMonthBucket[];
  // 金額を読めず予測に含めなかった行の数
  unreadableCount: number;
}
// asOfDate から horizonMonths か月分の入出金予測。残高が残っている売掛金/買掛金のみ対象。
// 期限超過分（dueDate < asOfDate）は最初のバケット（当月）に繰り入れる
// （もう到来しているはずの入出金として、直近の資金繰りに反映するため）。
export function computeCashFlowForecast(
  entries: ArApEntry[],
  asOfDate: string,
  horizonMonths: number,
): CashFlowForecast {
  const asOfYearMonth = asOfDate.slice(0, 7);
  const [asOfYear, asOfMonth] = asOfYearMonth.split('-').map(Number) as [number, number];

  const bucketKeys: string[] = [];
  for (let i = 0; i < horizonMonths; i++) {
    const totalMonth = asOfMonth - 1 + i;
    const y = asOfYear + Math.floor(totalMonth / 12);
    const m = (totalMonth % 12) + 1;
    bucketKeys.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  const firstBucketKey = bucketKeys[0]!;
  const buckets = new Map<string, { inflow: Decimal; outflow: Decimal }>(
    bucketKeys.map((k) => [k, { inflow: D(0), outflow: D(0) }]),
  );

  let unreadableCount = 0;
  for (const e of entries) {
    const remaining = remainingBalance(e);
    // 期日なしの請求書は '' で保存されるため、これまでどおり最初の月に入れる
    const dueDate: unknown = e.dueDate;
    const dueReadable = dueDate === '' || isValidIsoDate(dueDate);
    const type: unknown = e.type;
    if (remaining === undefined || !dueReadable || (type !== 'receivable' && type !== 'payable')) {
      unreadableCount++;
      continue;
    }
    if (remaining.lessThanOrEqualTo(0)) {
      continue;
    }
    const dueYearMonth = e.dueDate.slice(0, 7);
    const key = dueYearMonth < firstBucketKey ? firstBucketKey : dueYearMonth;
    const bucket = buckets.get(key);
    if (!bucket) {
      continue; // 予測期間より先の期日分は対象外
    }
    if (e.type === 'receivable') {
      bucket.inflow = bucket.inflow.plus(remaining);
    } else {
      bucket.outflow = bucket.outflow.plus(remaining);
    }
  }

  const months = bucketKeys.map((key): CashFlowMonthBucket => {
    const b = buckets.get(key)!;
    return {
      yearMonth: key,
      expectedInflow: b.inflow.toString(),
      expectedOutflow: b.outflow.toString(),
      netChange: b.inflow.minus(b.outflow).toString(),
    };
  });

  return { asOfDate, months, unreadableCount };
}

export async function forecastCashFlow(
  asOfDate: string,
  horizonMonths: number,
): Promise<CashFlowForecast> {
  const entries = await db.arApEntries.toArray();
  return computeCashFlowForecast(entries, asOfDate, horizonMonths);
}
