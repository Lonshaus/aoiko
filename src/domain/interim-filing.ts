// 消費税の中間申告義務判定・予定納付額の算出（消費税法 42 条・同施行令 23 条〜）。
// 個人事業者（暦年課税）のみを対象とする。前年（前課税期間）の確定消費税額
// （国税のみ、地方消費税を含まない）を基準に、当年の中間申告義務・回数・
// 各期間の対象期間・提出期限・予定納付額（前年確定額の按分）を求める。
//
// 予定申告方式（前年確定額を按分するだけ）を前提とした金額。仮決算方式
// （実際の期間の営業成績で計算）を選ぶ場合は consumption-tax.ts の
// computeGeneral 等に period を渡して別途計算する（本モジュールは対象外）。
import { D, Decimal } from '../lib/decimal';
import { filingBreakdown, type ConsumptionTaxBreakdown } from './consumption-tax';

export type InterimInstallmentCount = 0 | 1 | 3 | 11;

export interface InterimInstallment {
  /** 対象期間・開始日（ISO） */
  start: string;
  /** 対象期間・終了日（ISO） */
  end: string;
  /** 提出・納付期限（ISO） */
  dueDate: string;
  /** 予定納付額（前年確定額の按分、国税・地方消費税・合計） */
  amount: ConsumptionTaxBreakdown;
}

export interface InterimFilingObligation {
  installmentCount: InterimInstallmentCount;
  installments: InterimInstallment[];
}

function ymd(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
// (year, month) の月末の endMonthsAfter ヶ月後の月末日を返す（提出期限の算出用）。
function monthEndAfter(year: number, month: number, monthsAfter: number): string {
  const total = month - 1 + monthsAfter;
  const y = year + Math.floor(total / 12);
  const m = (total % 12) + 1;
  return ymd(y, m, lastDayOfMonth(y, m));
}

function installmentAmount(
  priorYearNationalTax: Decimal,
  divisor: number,
): ConsumptionTaxBreakdown {
  const national = priorYearNationalTax.dividedBy(divisor).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  return filingBreakdown(national);
}
// 前年確定消費税額（国税のみ）から当年の中間申告義務を判定する。
//  48万円以下：義務なし
//  48万円超 400万円以下：年1回（前年額×6/12、対象期間1/1-6/30、期限8/31）
//  400万円超 4800万円以下：年3回（前年額×3/12、各四半期、期限は各四半期末+2月）
//  4800万円超：年11回（前年額×1/12、毎月、期限は各月末+2月）
export function interimFilingObligation(
  year: number,
  priorYearNationalTax: Decimal,
): InterimFilingObligation {
  if (priorYearNationalTax.lessThanOrEqualTo(480_000)) {
    return { installmentCount: 0, installments: [] };
  }
  if (priorYearNationalTax.lessThanOrEqualTo(4_000_000)) {
    return {
      installmentCount: 1,
      installments: [
        {
          start: ymd(year, 1, 1),
          end: ymd(year, 6, 30),
          dueDate: ymd(year, 8, 31),
          amount: installmentAmount(priorYearNationalTax, 2),
        },
      ],
    };
  }
  if (priorYearNationalTax.lessThanOrEqualTo(48_000_000)) {
    const amount = installmentAmount(priorYearNationalTax, 4);
    const quarters: Array<[number, number, string]> = [
      [1, 3, ymd(year, 5, 31)],
      [4, 6, ymd(year, 8, 31)],
      [7, 9, ymd(year, 11, 30)],
    ];
    return {
      installmentCount: 3,
      installments: quarters.map(([startMonth, endMonth, dueDate]) => ({
        start: ymd(year, startMonth, 1),
        end: ymd(year, endMonth, lastDayOfMonth(year, endMonth)),
        dueDate,
        amount,
      })),
    };
  }
  const amount = installmentAmount(priorYearNationalTax, 12);
  const installments: InterimInstallment[] = [];
  for (let month = 1; month <= 11; month++) {
    installments.push({
      start: ymd(year, month, 1),
      end: ymd(year, month, lastDayOfMonth(year, month)),
      dueDate: monthEndAfter(year, month, 2),
      amount,
    });
  }
  return { installmentCount: 11, installments };
}
