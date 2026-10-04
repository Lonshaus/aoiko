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

type InterimInstallmentCount = 0 | 1 | 3 | 11;

interface InterimInstallment {
  /** 対象期間・開始日（ISO） */
  start: string;
  /** 対象期間・終了日（ISO） */
  end: string;
  /** 提出・納付期限（ISO） */
  dueDate: string;
  /** 予定納付額（前年確定額の按分、国税・地方消費税・合計） */
  amount: ConsumptionTaxBreakdown;
}

interface InterimFilingObligation {
  installmentCount: InterimInstallmentCount;
  installments: InterimInstallment[];
  // 任意の中間申告（42条8項）は期限までに出さないと取りやめとみなされ（同条11項）、44条のみなし申告は生じない
  voluntary?: true;
}

export interface InterimVoluntaryInputs {
  interimVoluntaryFiled?: boolean;
  interimVoluntaryLapsed?: boolean;
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
// 割ってから掛けると循環小数の丸めで1円ずれるため先に掛ける
function installmentAmount(
  priorYearNationalTax: Decimal,
  priorPeriodMonths: number,
  months: number,
): ConsumptionTaxBreakdown {
  const national = priorYearNationalTax
    .times(months)
    .dividedBy(priorPeriodMonths)
    .toDecimalPlaces(0, Decimal.ROUND_DOWN);
  return filingBreakdown(national);
}
// 除算の丸めを避けるため両辺に月数を掛けて比べる
function exceeds(
  priorYearNationalTax: Decimal,
  priorPeriodMonths: number,
  months: number,
  limit: number,
): boolean {
  return priorYearNationalTax.times(months).greaterThan(D(limit).times(priorPeriodMonths));
}
// 消法42条1項・4項・6項：確定消費税額 ÷ 直前の課税期間の月数の×1 が400万円超で年11回、×3 が100万円超で年3回、×6 が24万円超で年1回
export function interimFilingObligation(
  year: number,
  priorYearNationalTax: Decimal,
  months = 12,
  voluntaryInputs: InterimVoluntaryInputs = {},
): InterimFilingObligation {
  if (!exceeds(priorYearNationalTax, months, 6, 240_000)) {
    if (
      voluntaryInputs.interimVoluntaryFiled === true &&
      voluntaryInputs.interimVoluntaryLapsed !== true
    ) {
      return {
        installmentCount: 1,
        installments: [
          {
            start: ymd(year, 1, 1),
            end: ymd(year, 6, 30),
            dueDate: ymd(year, 8, 31),
            amount: installmentAmount(priorYearNationalTax, months, 6),
          },
        ],
        voluntary: true,
      };
    }
    return { installmentCount: 0, installments: [] };
  }
  if (!exceeds(priorYearNationalTax, months, 3, 1_000_000)) {
    return {
      installmentCount: 1,
      installments: [
        {
          start: ymd(year, 1, 1),
          end: ymd(year, 6, 30),
          dueDate: ymd(year, 8, 31),
          amount: installmentAmount(priorYearNationalTax, months, 6),
        },
      ],
    };
  }
  if (!exceeds(priorYearNationalTax, months, 1, 4_000_000)) {
    const amount = installmentAmount(priorYearNationalTax, months, 3);
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
  const amount = installmentAmount(priorYearNationalTax, months, 1);
  const installments: InterimInstallment[] = [];
  for (let month = 1; month <= 11; month++) {
    // 個人事業者は課税期間開始直後の分の期限が繰り下がる。消費税法42条1項が
    // 1か月目を「開始の日から二月を経過した日から二月以内」とし、措令46条の2
    // 第1項がその「二月」を「三月」と読み替えるため、1月分〜3月分は揃って5月31日。
    const dueDate = month <= 3 ? ymd(year, 5, 31) : monthEndAfter(year, month, 2);
    installments.push({
      start: ymd(year, month, 1),
      end: ymd(year, month, lastDayOfMonth(year, month)),
      dueDate,
      amount,
    });
  }
  return { installmentCount: 11, installments };
}
