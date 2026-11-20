// 総合課税の利子・配当・譲渡・一時所得と、所得税法69条1項・所令198条の損益通算。
//
// 金額は 3 種類に分ける。合計所得金額（基礎控除の区分・配偶者控除の本人所得など）、
// 総所得金額等（医療費控除・寄附金控除の基準）、総所得金額（課税総所得金額の基礎）。
// 退職・山林・分離課税と繰越控除がない現時点では 3 つの値は同じ。

import { D, Decimal } from '../../lib/decimal';
import type { FixedAsset } from '../../db/types';
import {
  aggregateTransferIncome,
  estimateTransferIncome,
  isLandBuildingAsset,
  transferIncomeByTerm,
} from '../../domain/asset-disposal';
import { buildDepreciationInputs, type EffectiveBusinessDates } from '../../domain/depreciation';
import {
  fixedAssetIssueScope,
  fixedAssetLabel,
  validateFixedAsset,
} from '../../domain/fixed-asset-check';

const OCCASIONAL_SPECIAL_DEDUCTION = 500_000;

export interface GeneralTransferItemInput {
  term: 'short' | 'long';
  revenue: Decimal;
  acquisitionCost: Decimal;
  expenses: Decimal;
  nonEssential: boolean;
}

export interface GeneralIncomeInput {
  interestIncome?: { amount: Decimal; withholdingTax: Decimal };
  dividendIncome?: { revenue: Decimal; debtInterest: Decimal; withholdingTax: Decimal };
  generalTransferIncome?: GeneralTransferItemInput[];
  occasionalIncome?: {
    revenue: Decimal;
    expenses: Decimal;
    withholdingTax: Decimal;
    category: string;
    payerName: string;
    payerAddress: string;
  };
}

export function interestIncomeAmount(input: GeneralIncomeInput): Decimal {
  return input.interestIncome?.amount ?? D(0);
}
// 所法24条2項：配当所得＝収入−負債の利子。0 を下回らない。
export function dividendIncomeAmount(input: GeneralIncomeInput): Decimal {
  const dividend = input.dividendIncome;
  if (!dividend) {
    return D(0);
  }
  return Decimal.max(dividend.revenue.minus(dividend.debtInterest), 0);
}
// 所法34条2項：一時所得＝収入−支出−特別控除（50 万円まで）。0 を下回らない。
export function occasionalIncomeAmount(input: GeneralIncomeInput): Decimal {
  const occasional = input.occasionalIncome;
  if (!occasional) {
    return D(0);
  }
  return Decimal.max(
    occasional.revenue.minus(occasional.expenses).minus(OCCASIONAL_SPECIAL_DEDUCTION),
    0,
  );
}

export function hasOccasionalIncome(input: GeneralIncomeInput): boolean {
  return input.occasionalIncome?.revenue.greaterThan(0) ?? false;
}

function itemNet(item: GeneralTransferItemInput): Decimal {
  return item.revenue.minus(item.acquisitionCost).minus(item.expenses);
}

function activeTransferItems(input: GeneralIncomeInput): GeneralTransferItemInput[] {
  return (input.generalTransferIncome ?? []).filter(
    (i) => !i.revenue.isZero() || !i.acquisitionCost.isZero() || !i.expenses.isZero(),
  );
}
// 固定資産台帳の売却のうち総合課税の譲渡所得（建物等を除く）の年合計。
export interface FixedAssetTransferTotals {
  /** transferIncomeByTerm の短期・長期（通算前、特別控除前） */
  shortTerm: Decimal;
  longTerm: Decimal;
  shortRevenue: Decimal;
  shortExpense: Decimal;
  longRevenue: Decimal;
  longExpense: Decimal;
  shortCount: number;
  longCount: number;
  /** 譲渡損になった資産の件数。生活に通常必要でない資産は台帳にないため全て該当しない */
  lossAssetCount: number;
  /** 分離課税の譲渡所得（建物等）として計算に含めなかった資産の名前 */
  separateNames: string[];
}

export type FixedAssetTransfer =
  { ok: true; totals: FixedAssetTransferTotals } | { ok: false; names: string[] };

export const NO_FIXED_ASSET_TRANSFER: Extract<FixedAssetTransfer, { ok: true }> = {
  ok: true,
  totals: {
    shortTerm: D(0),
    longTerm: D(0),
    shortRevenue: D(0),
    shortExpense: D(0),
    longRevenue: D(0),
    longExpense: D(0),
    shortCount: 0,
    longCount: 0,
    lossAssetCount: 0,
    separateNames: [],
  },
};
// 譲渡所得になるのは売却だけ。除却は対象外なので、除却しかない年は計算も失敗もしない（設定画面と同じ絞り込み）。
function soldInYear(assets: readonly FixedAsset[], year: number): FixedAsset[] {
  return assets.filter(
    (a) =>
      a.disposalType === 'sale' &&
      typeof a.disposedDate === 'string' &&
      Number(a.disposedDate.slice(0, 4)) === year,
  );
}

function computeFixedAssetTransfer(
  assets: readonly FixedAsset[],
  disposed: FixedAsset[],
  year: number,
  dates: EffectiveBusinessDates,
): FixedAssetTransfer {
  const failed = disposed.filter((a) =>
    validateFixedAsset(a).some((i) => {
      const scope = fixedAssetIssueScope(i);
      return scope === 'compute' || (scope === 'disposal' && a.disposalType === 'sale');
    }),
  );
  if (failed.length > 0) {
    return { ok: false, names: failed.map(fixedAssetLabel) };
  }
  try {
    const { statuses } = buildDepreciationInputs(
      assets,
      dates.businessStartDates,
      dates.businessCloseDate,
    );
    const totals: FixedAssetTransferTotals = {
      ...NO_FIXED_ASSET_TRANSFER.totals,
      separateNames: [],
    };
    for (const a of disposed) {
      const estimate = estimateTransferIncome(a, statuses);
      if (!estimate) {
        continue;
      }
      if (estimate.taxation === 'separate') {
        totals.separateNames.push(fixedAssetLabel(a));
        continue;
      }
      const revenue = D(estimate.proceeds);
      const expense = D(estimate.acquisitionExpense).plus(estimate.saleExpenses);
      if (estimate.term === 'short') {
        totals.shortRevenue = totals.shortRevenue.plus(revenue);
        totals.shortExpense = totals.shortExpense.plus(expense);
        totals.shortCount++;
      } else {
        totals.longRevenue = totals.longRevenue.plus(revenue);
        totals.longExpense = totals.longExpense.plus(expense);
        totals.longCount++;
      }
      if (D(estimate.estimate).isNegative()) {
        totals.lossAssetCount++;
      }
    }
    const byTerm = transferIncomeByTerm(
      disposed.filter((a) => !isLandBuildingAsset(a)),
      year,
      statuses,
    );
    totals.shortTerm = D(byTerm.shortTerm);
    totals.longTerm = D(byTerm.longTerm);
    return { ok: true, totals };
  } catch {
    return { ok: false, names: disposed.map(fixedAssetLabel) };
  }
}
// 当年に売却した資産がなければ開業日・廃業日も資産の状態も読まず、譲渡所得は 0 とする。
// 1 件でも計算できなければ部分的な合計は返さず、対象の資産名を返す。
export async function resolveFixedAssetTransfer(
  assets: readonly FixedAsset[],
  year: number,
  loadBusinessDates: () => Promise<EffectiveBusinessDates>,
): Promise<FixedAssetTransfer> {
  const disposed = soldInYear(assets, year);
  if (disposed.length === 0) {
    return NO_FIXED_ASSET_TRANSFER;
  }
  let dates: EffectiveBusinessDates;
  try {
    dates = await loadBusinessDates();
  } catch {
    return { ok: false, names: disposed.map(fixedAssetLabel) };
  }
  return computeFixedAssetTransfer(assets, disposed, year, dates);
}

export interface GeneralIncomeParams {
  /** 経常所得（利子・配当・不動産・事業・給与・雑）。損益通算前、事業・不動産の損失を含む */
  ordinary: Decimal;
  businessLoss: boolean;
  realEstateLoss: boolean;
  input: GeneralIncomeInput;
  fixedAssetTransfer: FixedAssetTransferTotals;
}

export interface GeneralIncomeResult {
  /** 総合譲渡の短期・長期（譲渡内の通算と特別控除 50 万円の後、損益通算の前）と一時所得 */
  short: Decimal;
  long: Decimal;
  occasional: Decimal;
  hasTransfer: boolean;
  hasOccasional: boolean;
  /** 損益通算後の各所得（残った損失は負で残る） */
  nettedOrdinary: Decimal;
  nettedShort: Decimal;
  nettedLong: Decimal;
  nettedOccasional: Decimal;
  /** 総所得金額（所法22条2項）。長期譲渡と一時所得の 1/2 は通算後に求め、1 円未満を切り捨てる */
  aggregate: Decimal;
  /** 生活に通常必要でない資産とその他の資産の両方に損失があり、法令で配分が決まらない */
  unconfirmed: boolean;
  /** 手引きが『損益の通算の計算書』を求める組み合わせ（事業・不動産・総合譲渡のいずれかが赤字） */
  nettingStatementRequired: boolean;
}
// Decimal の -0 は isNegative() が真になるため、0 のときは符号を反転しない。
function negatedOrZero(v: Decimal): Decimal {
  return v.isZero() ? D(0) : v.negated();
}
// 所令198条：経常所得の損失は譲渡（短期→長期）・一時所得から、譲渡所得の損失は一時所得・経常所得の順に引く。
function netIncomes(
  ordinary: Decimal,
  short: Decimal,
  long: Decimal,
  occasional: Decimal,
): { ordinary: Decimal; short: Decimal; long: Decimal; occasional: Decimal } {
  const gains = { short, long, occasional };
  // 2号：譲渡所得の損失はまず一時所得から引く。3号の一時所得は「前号の規定による控除後の金額」なので先に済ませる。
  for (const key of ['short', 'long'] as const) {
    if (!gains[key].isNegative()) {
      continue;
    }
    const fromOccasional = Decimal.min(gains[key].negated(), gains.occasional);
    gains.occasional = gains.occasional.minus(fromOccasional);
    gains[key] = negatedOrZero(gains[key].negated().minus(fromOccasional));
  }
  // 1号・3号：経常所得の損失は、他の経常所得と相殺した残りを譲渡（短期→長期）・一時所得の順に引く。
  if (ordinary.isNegative()) {
    let remainingOrdinaryLoss = ordinary.negated();
    for (const key of ['short', 'long', 'occasional'] as const) {
      const take = Decimal.min(remainingOrdinaryLoss, Decimal.max(gains[key], 0));
      gains[key] = gains[key].minus(take);
      remainingOrdinaryLoss = remainingOrdinaryLoss.minus(take);
    }
    ordinary = negatedOrZero(remainingOrdinaryLoss);
  }
  // 4号：2号で引ききれない譲渡所得の損失は経常所得から引く。
  for (const key of ['short', 'long'] as const) {
    if (!gains[key].isNegative()) {
      continue;
    }
    const fromOrdinary = Decimal.min(gains[key].negated(), Decimal.max(ordinary, 0));
    ordinary = ordinary.minus(fromOrdinary);
    gains[key] = negatedOrZero(gains[key].negated().minus(fromOrdinary));
  }
  return { ordinary, ...gains };
}

export function computeGeneralIncome(params: GeneralIncomeParams): GeneralIncomeResult {
  const { input, fixedAssetTransfer: fa } = params;
  const items = activeTransferItems(input);
  const itemShort = items.filter((i) => i.term === 'short');
  const itemLong = items.filter((i) => i.term === 'long');
  const sum = (list: GeneralTransferItemInput[]) =>
    list.reduce((acc, i) => acc.plus(itemNet(i)), D(0));
  const aggregated = aggregateTransferIncome({
    shortTerm: fa.shortTerm.plus(sum(itemShort)).toString(),
    longTerm: fa.longTerm.plus(sum(itemLong)).toString(),
  });
  const short = D(aggregated.shortTermIncome);
  const long = D(aggregated.longTermIncome);
  const occasional = occasionalIncomeAmount(input);
  const hasTransfer = fa.shortCount + fa.longCount > 0 || items.length > 0;
  const hasOccasional = hasOccasionalIncome(input);
  const lossItems = items.filter((i) => itemNet(i).isNegative());
  const nonEssentialLoss = lossItems.some((i) => i.nonEssential);
  const essentialLoss = fa.lossAssetCount > 0 || lossItems.some((i) => !i.nonEssential);
  const hasTransferLoss = short.isNegative() || long.isNegative();
  const unconfirmed = hasTransferLoss && nonEssentialLoss && essentialLoss;
  // 所法69条2項：生活に通常必要でない資産の損失だけが残るときは、通算では生じなかったものとみなす
  const deemedNone = hasTransferLoss && nonEssentialLoss && !essentialLoss;
  const netted = netIncomes(
    params.ordinary,
    deemedNone ? Decimal.max(short, 0) : short,
    deemedNone ? Decimal.max(long, 0) : long,
    occasional,
  );
  const half = Decimal.max(netted.long.plus(netted.occasional), 0)
    .dividedBy(2)
    .toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const aggregate = netted.ordinary.plus(netted.short).plus(Decimal.min(netted.long, 0)).plus(half);
  return {
    short,
    long,
    occasional,
    hasTransfer,
    hasOccasional,
    nettedOrdinary: netted.ordinary,
    nettedShort: netted.short,
    nettedLong: netted.long,
    nettedOccasional: netted.occasional,
    aggregate,
    unconfirmed,
    nettingStatementRequired:
      (hasTransfer || hasOccasional) &&
      (params.businessLoss || params.realEstateLoss || hasTransferLoss),
  };
}
// 第一表 ABB00400 の総合譲渡・一時所得の金額。手引きの計算欄 I＝短期＋（長期＋一時）×1/2（1 円未満切捨て）。
export function transferAndOccasionalAmount(r: GeneralIncomeResult): Decimal {
  return r.short
    .plus(r.long.plus(r.occasional).dividedBy(2))
    .toDecimalPlaces(0, Decimal.ROUND_DOWN);
}
// 3 種類の金額。退職・山林・分離課税と繰越控除が加わる段階で値が分かれる。
export function aggregateIncomeAmount(r: GeneralIncomeResult): Decimal {
  return r.aggregate;
}

export function totalIncomeAmountEtc(r: GeneralIncomeResult): Decimal {
  return r.aggregate;
}

export function legalTotalIncomeAmount(r: GeneralIncomeResult): Decimal {
  return r.aggregate;
}
