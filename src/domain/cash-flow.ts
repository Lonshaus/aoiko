import { db } from '../db/db';
import { D, type Decimal } from '../lib/decimal';
import { newId } from '../lib/id';
import type { ArApEntry, ArApType } from '../db/types';

export function remainingBalance(entry: ArApEntry): Decimal {
  return D(entry.originalAmount).minus(entry.paidAmount);
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
// 入金・支払の一部/全部消込。残高を超える額は throw（過収受・過払いは別の記帳で扱う想定、
// ここでは単純な子帳の整合性のみ担保する）。
export class OverpaymentError extends Error {
  constructor() {
    super('残高を超える金額です');
    this.name = 'OverpaymentError';
  }
}

export async function recordPayment(id: string, amount: string): Promise<void> {
  const entry = await db.arApEntries.get(id);
  if (!entry) {
    throw new Error('対象の売掛金/買掛金が見つかりません');
  }
  const newPaid = D(entry.paidAmount).plus(amount);
  if (newPaid.greaterThan(entry.originalAmount)) {
    throw new OverpaymentError();
  }
  await db.arApEntries.update(id, { paidAmount: newPaid.toString() });
}

export interface CashFlowMonthBucket {
  yearMonth: string; // 'YYYY-MM'
  expectedInflow: string;
  expectedOutflow: string;
  netChange: string;
}

export interface CashFlowForecast {
  asOfDate: string;
  months: CashFlowMonthBucket[];
}
// asOfDate から horizonMonths か月分の入出金予測（C10）。残高が残っている売掛金/買掛金のみ対象。
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

  for (const e of entries) {
    const remaining = remainingBalance(e);
    if (remaining.lessThanOrEqualTo(0)) {
      continue;
    }
    const dueYearMonth = e.dueDate.slice(0, 7);
    const key = dueYearMonth < firstBucketKey ? firstBucketKey : dueYearMonth;
    const bucket = buckets.get(key);
    if (!bucket) {
      continue; // 予測期間より先の到期分は対象外
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

  return { asOfDate, months };
}

export async function forecastCashFlow(
  asOfDate: string,
  horizonMonths: number,
): Promise<CashFlowForecast> {
  const entries = await db.arApEntries.toArray();
  return computeCashFlowForecast(entries, asOfDate, horizonMonths);
}
