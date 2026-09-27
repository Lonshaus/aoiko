import { D, type Decimal } from '../../lib/decimal';
// 所得税法28条4項・別表第五（給与等の収入金額が660万円未満の場合の給与所得）。
// 別表第五は4,000円区分の階差表だが、各区分の値は「区分の下限額」に28条3項の
// 連続式（旧表＝現行28条3項、新表＝令和8年法律第12号施行後の28条3項）を適用した
// ものと一致する（qa/tax-sources/48_shotokuzeiho_28_beppyo5.md 全行を script で照合済み）。
// 旧表は令和8年12月1日前に最後の給与等の支払を受けた場合のみ使う（附則13条2項）。
export type SalaryIncomeTableVersion = 'old' | 'new';

const BRACKET_WIDTH = 4000;
const OLD_TABLE_THRESHOLD = 651_000;
const NEW_TABLE_THRESHOLD = 691_000;
const OLD_TABLE_FLAT_END = 1_900_000;
const NEW_TABLE_FLAT_END = 2_026_000;
const NEW_TABLE_EXCEPTION_END = 2_028_000;
const NEW_TABLE_EXCEPTION_VALUE = 1_336_000;
const HIGH_BRACKET_THRESHOLD = 3_600_000;
const TABLE_UPPER_LIMIT = 6_600_000;
// 現行28条3項1号・2号（190万円以下＝65万円、190万円超360万円以下＝65万円＋30%）に相当する控除額。
function oldTableDeduction(lo: Decimal): Decimal {
  if (lo.lessThanOrEqualTo(OLD_TABLE_FLAT_END)) {
    return D(650_000);
  }
  if (lo.lessThanOrEqualTo(HIGH_BRACKET_THRESHOLD)) {
    return D(650_000).plus(lo.minus(OLD_TABLE_FLAT_END).times(0.3));
  }
  return D(1_160_000).plus(lo.minus(HIGH_BRACKET_THRESHOLD).times(0.2));
}
// 未施行28条3項1号（360万円以下＝8万円＋30%、下限69万円）に相当する控除額。
function newTableDeduction(lo: Decimal): Decimal {
  if (lo.lessThanOrEqualTo(HIGH_BRACKET_THRESHOLD)) {
    const v = D(80_000).plus(lo.times(0.3));
    return v.greaterThanOrEqualTo(690_000) ? v : D(690_000);
  }
  return D(1_160_000).plus(lo.minus(HIGH_BRACKET_THRESHOLD).times(0.2));
}
// 区分の下限（4,000円単位、絶対原点からの階差）。
function bracketFloor(paidAmount: Decimal): Decimal {
  return paidAmount.dividedToIntegerBy(BRACKET_WIDTH).times(BRACKET_WIDTH);
}
// 給与等の収入金額が660万円未満の場合の、別表第五による給与所得（所法28条4項）。
// 660万円以上は呼出側で本則（28条3項）を使う（本関数の対象外）。
export function salaryIncomeFromTable(
  version: SalaryIncomeTableVersion,
  paidAmount: Decimal,
): Decimal {
  if (version === 'old') {
    if (paidAmount.lessThan(OLD_TABLE_THRESHOLD)) {
      return D(0);
    }
    if (paidAmount.lessThan(OLD_TABLE_FLAT_END)) {
      return paidAmount.minus(650_000);
    }
    const lo = bracketFloor(paidAmount);
    return lo.minus(oldTableDeduction(lo));
  }
  if (paidAmount.lessThan(NEW_TABLE_THRESHOLD)) {
    return D(0);
  }
  if (paidAmount.lessThan(NEW_TABLE_FLAT_END)) {
    return paidAmount.minus(690_000);
  }
  if (paidAmount.lessThan(NEW_TABLE_EXCEPTION_END)) {
    return D(NEW_TABLE_EXCEPTION_VALUE);
  }
  const lo = bracketFloor(paidAmount);
  return lo.minus(newTableDeduction(lo));
}

export function isWithinSalaryIncomeTableRange(paidAmount: Decimal): boolean {
  return paidAmount.lessThan(TABLE_UPPER_LIMIT);
}
