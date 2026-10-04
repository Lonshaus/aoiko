import { D, type Decimal } from '../../lib/decimal';
// 青色申告特別控除の区分。確定申告書・決算書の控除額算定に用いる。
//  - electronic：正規の簿記（複式）＋ e-Tax 申告または優良な電子帳簿 → 65万（令和8年分）/ 75万（令和9年分〜）
//  - doubleEntry：正規の簿記（複式）のみ（紙申告・非優良）→ 55万（令和8年分）/ 10万（令和9年分〜）
//  - simple：簡易簿記 → 10万
//  - none：控除なし
//  - eTax：正規の簿記（複式）＋ e-Tax 申告（優良な電子帳簿は問わない）→ 65万（令和8年分以後）
export type AoiroDeductionKind = 'electronic' | 'eTax' | 'doubleEntry' | 'simple' | 'none';
// 令和8年法律第12号附則33条：改正後の措法25条の2は令和9年分以後に適用。
const AOIRO_REFORM_YEAR = 2027;
const PRIOR_PRIOR_REVENUE_THRESHOLD = 10_000_000;
// 未設定の項目は「該当しない」として扱う（既存データの計算結果を変えない）。
export interface AoiroDeductionOptions {
  /** 所得税法67条1項（小規模事業者の現金主義）の適用を受ける */
  cashBasis?: boolean;
  /** 前々年分の事業所得に係る総収入金額（その年に事業を営む場合のみ渡す） */
  priorPriorBusinessRevenue?: Decimal;
  /** 前々年分の不動産所得に係る総収入金額（事業的規模の場合のみ渡す） */
  priorPriorRealEstateRevenue?: Decimal;
}

function exceedsPriorPriorRevenue(options: AoiroDeductionOptions): boolean {
  return [options.priorPriorBusinessRevenue, options.priorPriorRealEstateRevenue].some(
    (revenue) => revenue?.greaterThan(PRIOR_PRIOR_REVENUE_THRESHOLD) ?? false,
  );
}
// 令和9年分以後は措法25条の2第2項で前々年分総収入金額1,000万円超なら10万円も不可（現金主義者は対象外）。
function basicAoiroDeductionLimit(year: number, options: AoiroDeductionOptions): Decimal {
  if (year >= AOIRO_REFORM_YEAR && !options.cashBasis && exceedsPriorPriorRevenue(options)) {
    return D(0);
  }
  return D(100000);
}
// 区分ごとの控除限度額（円）。現金主義の適用者は55万・65万・75万の対象から除かれる。
export function aoiroDeductionLimit(
  year: number,
  kind: AoiroDeductionKind,
  options: AoiroDeductionOptions = {},
): Decimal {
  switch (kind) {
    case 'electronic':
      if (!options.cashBasis) {
        return D(year >= AOIRO_REFORM_YEAR ? 750000 : 650000);
      }
      return basicAoiroDeductionLimit(year, options);
    case 'eTax':
      if (!options.cashBasis) {
        return D(650000);
      }
      return basicAoiroDeductionLimit(year, options);
    case 'doubleEntry':
      // 正規の簿記（複式）を備えている点は electronic/eTax と同じ4項該当者のため、
      // 前々年分収入1,000万円超の2項制限（simple のみに及ぶ）を受けない。
      if (!options.cashBasis && year < AOIRO_REFORM_YEAR) {
        return D(550000);
      }
      return D(100000);
    case 'simple':
      return basicAoiroDeductionLimit(year, options);
    case 'none':
      return D(0);
  }
}
// 実際の青色申告特別控除額。控除前の事業所得（黒字分）を上限とする
// （赤字には適用せず、限度額と控除前所得の小さい方・下限 0）。
export function aoiroDeductionAmount(
  year: number,
  kind: AoiroDeductionKind,
  preDeductionIncome: Decimal,
  options: AoiroDeductionOptions = {},
): Decimal {
  const base = preDeductionIncome.greaterThan(0) ? preDeductionIncome : D(0);
  const limit = aoiroDeductionLimit(year, kind, options);
  return base.lessThan(limit) ? base : limit;
}
