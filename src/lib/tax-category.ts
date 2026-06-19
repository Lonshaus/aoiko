import type { TaxCategory } from '../db/types';
// 勘定科目の税区分から消費税率を返す。
// taxable10 / taxable8 のみ課税取引（売上税額・仕入税額控除の対象）。
// exempt（免税＝輸出等の 0%）・nontaxable（非課税・不課税）は 0。
export function taxRateForCategory(category: TaxCategory | undefined): number {
  switch (category) {
    case 'taxable10':
      return 0.1;
    case 'taxable8':
      return 0.08;
    default:
      return 0;
  }
}