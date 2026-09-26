import { D, Decimal } from '../../lib/decimal';
import { isWithinSalaryIncomeTableRange, salaryIncomeFromTable } from './salary-income-table';
// 給与所得・雑所得（B7-1）。
//
// 給与所得控除：令和8・9年分の収入69万1千円以上220万円未満は措法29条の4第2項の表を
// 優先する。それ以外で収入660万円未満は所法28条4項・別表第五（salary-income-table.ts）。
// 660万円以上は所法28条3項の本則。
//
// 公的年金等に係る雑所得は、年齢・年金額・他の所得の合計額の3軸で変わる速算表
// （改定頻度も高く複雑）のため aoiko では計算しない。国税庁の「公的年金等に係る
// 雑所得の速算表」または源泉徴収票記載の金額を、確定した雑所得額としてそのまま
// 入力する（income-deductions.ts 冒頭の設計方針と同じ判断）。
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
// その他雑所得（副業収入等）＝収入−必要経費。マイナスは0円に floor。
// 公的年金等は上記の理由により対象外（利用者が確定額を直接入力する）。
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

// miscExpensesOverride：措法27条（家内労働者等の特例）適用時の特例後の必要経費
// （home-worker-expense.ts、呼出元は xtx-mapping-koa020.ts）。未指定なら通常どおり
// misc.otherExpenses を使う。
export function otherIncomeAmount(
  year: number,
  input: OtherIncomeInput,
  miscExpensesOverride?: Decimal,
): Decimal {
  const salary = input.salaryIncome
    ? salaryIncomeAmount(
        year,
        input.salaryIncome.paidAmount,
        input.salaryIncome.lastPaymentBeforeDecember,
      )
    : D(0);
  const misc = input.miscIncome ?? {};
  const pension = misc.publicPensionAmount ?? D(0);
  const other = otherMiscIncome(
    misc.otherIncome ?? D(0),
    miscExpensesOverride ?? misc.otherExpenses ?? D(0),
  );
  return salary.plus(pension).plus(other);
}

export function totalWithholdingTax(input: OtherIncomeInput): Decimal {
  const salaryWithholding = input.salaryIncome?.withholdingTax ?? D(0);
  return salaryWithholding.plus(input.otherWithholdingTax ?? D(0));
}
