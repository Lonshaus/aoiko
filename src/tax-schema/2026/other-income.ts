import { D, Decimal } from '../../lib/decimal';
import { isWithinSalaryIncomeTableRange, salaryIncomeFromTable } from './salary-income-table';
// 給与所得・雑所得（B7-1）。
//
// 給与所得控除：令和8・9年分の収入69万1千円以上220万円未満は措法29条の4第2項の表を
// 優先する。それ以外で収入660万円未満は所法28条4項・別表第五（salary-income-table.ts）。
// 660万円以上は所法28条3項の本則。
//
// 公的年金等に係る雑所得は2通りで入力できる。収入金額（publicPensionRevenue）から
// 所法35条4項・措法41条の15の3に従って計算する方式と、国税庁の速算表や源泉徴収票の
// 確定額（publicPensionAmount）をそのまま入力する方式。後者は令和9年分以降に給与所得と
// 併せて受け取る場合に所法35条5項の調整を反映できないため、その場合は前者を使う。
const SALARY_SPECIAL_LAST_YEAR = 2027;
const SALARY_SPECIAL_THRESHOLD = 2_200_000;
const SALARY_SPECIAL_DEDUCTION = 740_000;
const SALARY_STANDARD_MIN_DEDUCTION = 690_000;

function isSalarySpecialYear(year: number): boolean {
  return year <= SALARY_SPECIAL_LAST_YEAR;
}

function standardSalaryIncomeDeduction(paidAmount: Decimal): Decimal {
  if (paidAmount.lessThanOrEqualTo(3_600_000)) {
    const amount = paidAmount.times(0.3).plus(80_000).toDecimalPlaces(0, Decimal.ROUND_DOWN);
    return amount.lessThan(SALARY_STANDARD_MIN_DEDUCTION)
      ? D(SALARY_STANDARD_MIN_DEDUCTION)
      : amount;
  }
  if (paidAmount.lessThanOrEqualTo(6_600_000)) {
    return paidAmount.times(0.2).plus(440_000).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  }
  if (paidAmount.lessThanOrEqualTo(8_500_000)) {
    return paidAmount.times(0.1).plus(1_100_000).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  }
  return D(1_950_000);
}
// 措法29条の4第2項は給与所得を直接定め控除額は変えないため、措法27条の最低保障はこの控除額を使う。
export function salaryIncomeDeduction(year: number, paidAmount: Decimal): Decimal {
  if (isSalarySpecialYear(year) && paidAmount.lessThanOrEqualTo(SALARY_SPECIAL_THRESHOLD)) {
    return paidAmount.lessThan(SALARY_SPECIAL_DEDUCTION) ? paidAmount : D(SALARY_SPECIAL_DEDUCTION);
  }
  return standardSalaryIncomeDeduction(paidAmount);
}

function specialSalaryIncomeAmount(paidAmount: Decimal): Decimal | undefined {
  if (paidAmount.lessThan(691_000) || paidAmount.greaterThanOrEqualTo(SALARY_SPECIAL_THRESHOLD)) {
    return undefined;
  }
  if (paidAmount.lessThan(741_000)) {
    return D(0);
  }
  if (paidAmount.lessThan(2_191_000)) {
    return paidAmount.minus(SALARY_SPECIAL_DEDUCTION);
  }
  if (paidAmount.lessThan(2_193_000)) {
    return D(1_451_000);
  }
  if (paidAmount.lessThan(2_196_000)) {
    return D(1_453_000);
  }
  return D(1_456_000);
}
// lastPaymentBeforeDecember：令和8年分のみ意味を持つ（附則13条2項）。最後の給与等の
// 支払日が2026-12-01より前なら旧表、それ以外（未指定含む）は新表。
export function salaryIncomeAmount(
  year: number,
  paidAmount: Decimal,
  lastPaymentBeforeDecember?: boolean,
): Decimal {
  const special = isSalarySpecialYear(year) ? specialSalaryIncomeAmount(paidAmount) : undefined;
  if (special) {
    return special;
  }
  if (isWithinSalaryIncomeTableRange(paidAmount)) {
    const version = year === 2026 && lastPaymentBeforeDecember ? 'old' : 'new';
    return salaryIncomeFromTable(version, paidAmount);
  }
  const amount = paidAmount.minus(salaryIncomeDeduction(year, paidAmount));
  return amount.lessThan(0) ? D(0) : amount;
}
// その他雑所得（副業収入等）＝収入−必要経費。マイナスは0円とする。公的年金等は含まない。
export function otherMiscIncome(income: Decimal, expenses: Decimal): Decimal {
  const amount = income.minus(expenses);
  return amount.lessThan(0) ? D(0) : amount;
}

interface SalaryIncomeInput {
  paidAmount: Decimal;
  withholdingTax: Decimal;
  /** 令和8年分のみ意味を持つ（所法28条4項・別表第五の新旧表判定、附則13条2項） */
  lastPaymentBeforeDecember?: boolean;
}

interface MiscIncomeInput {
  publicPensionAmount?: Decimal;
  /** 指定すると計算方式になる（publicPensionAmount は使わない） */
  publicPensionRevenue?: Decimal;
  publicPensionAge65OrOver?: boolean;
  otherIncome?: Decimal;
  otherExpenses?: Decimal;
}
// 給与所得・雑所得・（事業所得側の）源泉徴収税額。totalIncomeAmount（事業所得のみ）に
// 合算する形で xtx-mapping-koa020.ts の combinedTotalIncomeAmount() から使う。
export interface OtherIncomeInput {
  salaryIncome?: SalaryIncomeInput;
  miscIncome?: MiscIncomeInput;
  /** 事業所得側の源泉徴収税額（確定額を直接入力、取引単位の追跡は対象外） */
  otherWithholdingTax?: Decimal;
}
// 所得金額調整控除①（措法41条の3の11第1項、令和2年分以後）の要件のうち、本人の所得以外のもの。
// 扶養親族・同一生計配偶者の判定は income-deductions.ts の salaryAdjustmentEligibility() が行う。
export interface SalaryAdjustmentEligibility {
  selfSpecialDisabled: boolean;
  /** 年末の年齢が23歳未満の扶養親族がいる */
  hasDependentUnder23: boolean;
  /** 特別障害者である同一生計配偶者または扶養親族がいる */
  hasSpecialDisabledRelative: boolean;
}

const ADJUSTMENT_THRESHOLD = 8_500_000;
const ADJUSTMENT_CEILING = 10_000_000;
const PENSION_ADJUSTMENT_UNIT = 100_000;
// ①：給与等の収入が850万円超で要件を満たす場合、(min(収入, 1,000万円) − 850万円)×10%。
// 1円未満の端数は切り上げる（国税庁タックスアンサー No.1411）。
function salaryAdjustmentForFamily(
  paidAmount: Decimal,
  eligibility: SalaryAdjustmentEligibility | undefined,
): Decimal {
  if (
    !eligibility ||
    paidAmount.lessThanOrEqualTo(ADJUSTMENT_THRESHOLD) ||
    !(
      eligibility.selfSpecialDisabled ||
      eligibility.hasDependentUnder23 ||
      eligibility.hasSpecialDisabledRelative
    )
  ) {
    return D(0);
  }
  return Decimal.min(paidAmount, ADJUSTMENT_CEILING)
    .minus(ADJUSTMENT_THRESHOLD)
    .times(0.1)
    .toDecimalPlaces(0, Decimal.ROUND_UP);
}
// ②（措法41条の3の11第2項）：給与所得と公的年金等に係る雑所得の両方があり合計が10万円を
// 超えるとき、min(給与所得, 10万円) + min(年金所得, 10万円) − 10万円。合計が10万円以下なら負になるため0。
function salaryAdjustmentForPension(salaryIncome: Decimal, pensionIncome: Decimal): Decimal {
  const amount = Decimal.min(salaryIncome, PENSION_ADJUSTMENT_UNIT)
    .plus(Decimal.min(pensionIncome, PENSION_ADJUSTMENT_UNIT))
    .minus(PENSION_ADJUSTMENT_UNIT);
  return amount.greaterThan(0) ? amount : D(0);
}
export const PENSION_SALARY_CAP_FIRST_YEAR = 2027;
const PENSION_SALARY_CAP = 2_800_000;
const PENSION_TIER1_LIMIT = 10_000_000;
const PENSION_TIER2_LIMIT = 20_000_000;
// 公的年金等控除額（所法35条4項、措法41条の15の3）。nonPensionTotalIncome は
// 公的年金等に係る雑所得以外の合計所得金額。速算表の「収入×率−定額」は収入−控除額と
// 同じで、最低額との大きい方が各区分に対応する。65歳以上の区分も同じ式で表せる。
export function publicPensionDeduction(
  revenue: Decimal,
  age65OrOver: boolean,
  nonPensionTotalIncome: Decimal,
): Decimal {
  if (revenue.lessThanOrEqualTo(0)) {
    return D(0);
  }
  let reduction = 0;
  if (nonPensionTotalIncome.greaterThan(PENSION_TIER2_LIMIT)) {
    reduction = 200_000;
  } else if (nonPensionTotalIncome.greaterThan(PENSION_TIER1_LIMIT)) {
    reduction = 100_000;
  }
  const minimum = (age65OrOver ? 1_100_000 : 600_000) - reduction;
  let byRate: Decimal;
  if (revenue.lessThan(4_100_000)) {
    byRate = revenue.times(0.25).plus(275_000);
  } else if (revenue.lessThan(7_700_000)) {
    byRate = revenue.times(0.15).plus(685_000);
  } else if (revenue.lessThan(10_000_000)) {
    byRate = revenue.times(0.05).plus(1_455_000);
  } else {
    byRate = D(1_955_000);
  }
  return Decimal.max(minimum, byRate.minus(reduction));
}
// 1円未満の端数は切り捨て、マイナスは0円（国税庁の申告の手引き）。
function pensionIncomeAfterDeduction(revenue: Decimal, deduction: Decimal): Decimal {
  const amount = revenue.minus(deduction).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  return amount.greaterThan(0) ? amount : D(0);
}

export interface PublicPensionIncome {
  /** 合計所得金額に入る公的年金等に係る雑所得（令和9年分以降は所法35条5項の調整後） */
  amount: Decimal;
  /** 所得金額調整控除②の判定に使う、調整前の公的年金等に係る雑所得（措法41条の3の11第4項6号） */
  amountForAdjustment: Decimal;
}
// nonPensionTotalIncome は公的年金等以外の合計所得金額（所基通35-8）。
export function resolvePublicPensionIncome(
  year: number,
  input: OtherIncomeInput,
  nonPensionTotalIncome: Decimal,
): PublicPensionIncome {
  const misc = input.miscIncome;
  const revenue = misc?.publicPensionRevenue;
  if (revenue === undefined) {
    const amount = misc?.publicPensionAmount ?? D(0);
    return { amount, amountForAdjustment: amount };
  }
  const deduction = publicPensionDeduction(
    revenue,
    misc?.publicPensionAge65OrOver ?? false,
    nonPensionTotalIncome,
  );
  const amountForAdjustment = pensionIncomeAfterDeduction(revenue, deduction);
  if (year < PENSION_SALARY_CAP_FIRST_YEAR || !input.salaryIncome) {
    return { amount: amountForAdjustment, amountForAdjustment };
  }
  // 措法29条の4第1項の特例でも給与所得控除額は最大74万円で合計が280万円を超えないため、
  // 特例の有無に関わらず salaryIncomeDeduction の値で判定してよい。
  // 収入660万円未満は所法28条4項（別表第五）で給与所得を定めるが、控除額は同条3項の算式のまま
  // と読んで判定する。令和9年分の手引きの公布後に確認する。
  const excess = salaryIncomeDeduction(year, input.salaryIncome.paidAmount)
    .plus(deduction)
    .minus(PENSION_SALARY_CAP);
  if (excess.lessThanOrEqualTo(0)) {
    return { amount: amountForAdjustment, amountForAdjustment };
  }
  return {
    amount: pensionIncomeAfterDeduction(revenue, deduction.minus(excess)),
    amountForAdjustment,
  };
}
// 給与所得から所得金額調整控除①だけを差し引いた額。公的年金等以外の合計所得金額
// （所基通35-8）では②を適用しない。②は公的年金等の雑所得に依存し、適用すると循環するため。
export function salaryIncomeAfterFamilyAdjustment(
  year: number,
  input: OtherIncomeInput,
  eligibility?: SalaryAdjustmentEligibility,
): Decimal {
  const salary = input.salaryIncome;
  if (!salary) {
    return D(0);
  }
  return salaryIncomeAmount(year, salary.paidAmount, salary.lastPaymentBeforeDecember).minus(
    salaryAdjustmentForFamily(salary.paidAmount, eligibility),
  );
}
// 給与所得（給与所得控除後）から所得金額調整控除①②を差し引いた額。
// ②の給与側は①を引く前の給与所得を使う（措法41条の3の11第4項5号）。
export function adjustedSalaryIncomeAmount(
  year: number,
  input: OtherIncomeInput,
  eligibility: SalaryAdjustmentEligibility | undefined,
  pension: PublicPensionIncome,
): Decimal {
  const salary = input.salaryIncome;
  if (!salary) {
    return D(0);
  }
  const beforeAdjustment = salaryIncomeAmount(
    year,
    salary.paidAmount,
    salary.lastPaymentBeforeDecember,
  );
  const adjusted = beforeAdjustment
    .minus(salaryAdjustmentForFamily(salary.paidAmount, eligibility))
    .minus(salaryAdjustmentForPension(beforeAdjustment, pension.amountForAdjustment));
  return adjusted.greaterThan(0) ? adjusted : D(0);
}

function otherMiscIncomeOf(input: OtherIncomeInput, miscExpensesOverride?: Decimal): Decimal {
  const misc = input.miscIncome ?? {};
  return otherMiscIncome(
    misc.otherIncome ?? D(0),
    miscExpensesOverride ?? misc.otherExpenses ?? D(0),
  );
}
// 公的年金等に係る雑所得を除いた、給与所得（①の後）とその他雑所得の合計。
// 公的年金等控除額の区分を決める「公的年金等以外の合計所得金額」の一部になる。
export function nonPensionOtherIncomeAmount(
  year: number,
  input: OtherIncomeInput,
  miscExpensesOverride?: Decimal,
  eligibility?: SalaryAdjustmentEligibility,
): Decimal {
  return salaryIncomeAfterFamilyAdjustment(year, input, eligibility).plus(
    otherMiscIncomeOf(input, miscExpensesOverride),
  );
}
// miscExpensesOverride：措法27条（家内労働者等の特例）適用時の特例後の必要経費
// （home-worker-expense.ts、呼出元は xtx-mapping-koa020.ts）。未指定なら通常どおり
// misc.otherExpenses を使う。
export function otherIncomeAmount(
  year: number,
  input: OtherIncomeInput,
  miscExpensesOverride: Decimal | undefined,
  eligibility: SalaryAdjustmentEligibility | undefined,
  pension: PublicPensionIncome,
): Decimal {
  return adjustedSalaryIncomeAmount(year, input, eligibility, pension)
    .plus(pension.amount)
    .plus(otherMiscIncomeOf(input, miscExpensesOverride));
}

export function totalWithholdingTax(input: OtherIncomeInput): Decimal {
  const salaryWithholding = input.salaryIncome?.withholdingTax ?? D(0);
  return salaryWithholding.plus(input.otherWithholdingTax ?? D(0));
}
