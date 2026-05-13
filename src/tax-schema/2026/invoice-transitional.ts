// インボイス制度 経過措置：免税事業者等からの仕入れに係る仕入税額控除割合。
// 令和8年度税制改正で 80% → 70% → 50% → 30% に細分化、令和 13/9 完全廃止まで延長。
// 出典：消費税法附則 52・53、令和8年度税制改正大綱 第二 7。

// 各境界日（取引日がその日以後にこの区分に入る）。
export const TRANSITIONAL_BOUNDARY_2026_10 = '2026-10-01';
export const TRANSITIONAL_BOUNDARY_2028_10 = '2028-10-01';
export const TRANSITIONAL_BOUNDARY_2030_10 = '2030-10-01';
export const TRANSITIONAL_BOUNDARY_2031_10 = '2031-10-01';

// 取引日（仕入日）に応じた仕入税額控除の控除割合を返す。
// - 2023/10/01 〜 2026/09/30：80%
// - 2026/10/01 〜 2028/09/30：70%（令和 8 改正で新設）
// - 2028/10/01 〜 2030/09/30：50%
// - 2030/10/01 〜 2031/09/30：30%（令和 8 改正で新設）
// - 2031/10/01 〜：0%（完全廃止）
//
// 適格請求書発行事業者からの仕入は 100% 控除可能、本関数は使わない。
// この関数は「免税事業者等（適格請求書なし）からの仕入」に限定して適用する。
export function transitionalCreditRate(transactionDate: string): number {
  if (transactionDate < TRANSITIONAL_BOUNDARY_2026_10) {
    return 0.8;
  }
  if (transactionDate < TRANSITIONAL_BOUNDARY_2028_10) {
    return 0.7;
  }
  if (transactionDate < TRANSITIONAL_BOUNDARY_2030_10) {
    return 0.5;
  }
  if (transactionDate < TRANSITIONAL_BOUNDARY_2031_10) {
    return 0.3;
  }
  return 0;
}

// 経過措置の人間可読ラベル（UI 表示用）。
export type TransitionalPeriodLabel =
  | '80%（2023/10〜2026/9）'
  | '70%（2026/10〜2028/9）'
  | '50%（2028/10〜2030/9）'
  | '30%（2030/10〜2031/9）'
  | '0%（2031/10〜、適用外）';

export function transitionalPeriodLabel(
  transactionDate: string
): TransitionalPeriodLabel {
  if (transactionDate < TRANSITIONAL_BOUNDARY_2026_10) {
    return '80%（2023/10〜2026/9）';
  }
  if (transactionDate < TRANSITIONAL_BOUNDARY_2028_10) {
    return '70%（2026/10〜2028/9）';
  }
  if (transactionDate < TRANSITIONAL_BOUNDARY_2030_10) {
    return '50%（2028/10〜2030/9）';
  }
  if (transactionDate < TRANSITIONAL_BOUNDARY_2031_10) {
    return '30%（2030/10〜2031/9）';
  }
  return '0%（2031/10〜、適用外）';
}