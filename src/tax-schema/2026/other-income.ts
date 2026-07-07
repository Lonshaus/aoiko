import { D, Decimal } from '../../lib/decimal';
// 給与所得・雑所得（B7-1）。
//
// 給与所得控除は令和8・9年分限定の最低保障額引上げ特例を反映：給与収入
// 220万円以下は一律74万円（収入220万円で「収入×30%+8万円」と接続する値）。
// 令和10年分以降は本則69万円に戻る予定で、しきい値も変わるため別途再検証が必要。
// 出典：nta.go.jp/taxes/shiraberu/taxanswer/1410.htm（令和7年分以降の基本表）
// および令和8年度税制改正の解説記事で確認した「220万円以下→74万円」の接続点。
// 中〜高収入帯（30%/20%/10%の各区分）は複数回の改正を経ても変わっていない。
//
// 公的年金等に係る雑所得は、年齢・年金額・他の所得の合計額の3軸で変わる速算表
// （改定頻度も高く複雑）のため aoiko では計算しない。国税庁の「公的年金等に係る
// 雑所得の速算表」または源泉徴収票記載の金額を、確定した雑所得額としてそのまま
// 入力する（income-deductions.ts 冒頭の設計方針と同じ判断）。

const SALARY_MIN_DEDUCTION_THRESHOLD = 2_200_000; // 令和8・9年分限定
const SALARY_MIN_DEDUCTION = 740_000; // 同上

export function salaryIncomeDeduction(paidAmount: Decimal): Decimal {
  if (paidAmount.lessThanOrEqualTo(SALARY_MIN_DEDUCTION_THRESHOLD)) {
    return D(SALARY_MIN_DEDUCTION);
  }
  if (paidAmount.lessThanOrEqualTo(3_600_000)) {
    return paidAmount.times(0.3).plus(80_000).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  }
  if (paidAmount.lessThanOrEqualTo(6_600_000)) {
    return paidAmount.times(0.2).plus(440_000).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  }
  if (paidAmount.lessThanOrEqualTo(8_500_000)) {
    return paidAmount.times(0.1).plus(1_100_000).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  }
  return D(1_950_000);
}

export function salaryIncomeAmount(paidAmount: Decimal): Decimal {
  const amount = paidAmount.minus(salaryIncomeDeduction(paidAmount));
  return amount.lessThan(0) ? D(0) : amount;
}
// その他雑所得（副業収入等）＝収入−必要経費。マイナスは0円に floor。
// 公的年金等は上記の理由により対象外（利用者が確定額を直接入力する）。
export function otherMiscIncome(income: Decimal, expenses: Decimal): Decimal {
  const amount = income.minus(expenses);
  return amount.lessThan(0) ? D(0) : amount;
}

export interface SalaryIncomeInput {
  paidAmount: Decimal;
  withholdingTax: Decimal;
}

export interface MiscIncomeInput {
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

export function otherIncomeAmount(input: OtherIncomeInput): Decimal {
  const salary = input.salaryIncome ? salaryIncomeAmount(input.salaryIncome.paidAmount) : D(0);
  const misc = input.miscIncome ?? {};
  const pension = misc.publicPensionAmount ?? D(0);
  const other = otherMiscIncome(misc.otherIncome ?? D(0), misc.otherExpenses ?? D(0));
  return salary.plus(pension).plus(other);
}

export function totalWithholdingTax(input: OtherIncomeInput): Decimal {
  const salaryWithholding = input.salaryIncome?.withholdingTax ?? D(0);
  return salaryWithholding.plus(input.otherWithholdingTax ?? D(0));
}