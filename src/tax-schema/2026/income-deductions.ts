// 所得控除・税額控除・累進課税の計算（令和8年分/2026年度）。
//
// aoiko は本来「事業の損益のみ」を扱うが、利用者の申し出により、確定申告書の
// 「所得から差し引かれる金額」「税金の計算」（KOA020 第一表 ABB00420〜ABB01040）まで
// 計算対象に含める。雑損控除・住宅ローン控除・外国税額控除・その他の税額控除・
// 政党等寄附金等特別控除・住宅耐震改修特別控除等・災害減免額は、罹災状況・借入金
// 年末残高の年次推移・外国納税証明等、本人の個別事情に強く依存し制度も複雑なため、
// 利用者が国税庁の計算結果（確定額）をそのまま入力する方式とする
// （e-Tax・税理士による計算を前提、aoiko は転記のみ）。
// セルフメディケーション税制は医療費控除との選択制のため対象外（通常の医療費控除のみ）。

import { D, Decimal } from '../../lib/decimal';

export interface SpouseInput {
  totalIncome: Decimal;
  age: number;
}

export interface DependentInput {
  id: string;
  /** 年末時点の満年齢 */
  age: number;
  totalIncome: Decimal;
  /** 老人扶養親族のうち、納税者又は配偶者と同居している直系尊属か */
  livesWithLinealAscendant?: boolean;
}

export interface LifeInsurancePayments {
  newGeneral?: Decimal;
  oldGeneral?: Decimal;
  newMedical?: Decimal;
  newPension?: Decimal;
  oldPension?: Decimal;
}

export interface IncomeDeductionInput {
  /** 合計所得金額（申告者本人） */
  totalIncome: Decimal;
  socialInsurancePaid: Decimal;
  smallBusinessMutualAidPaid: Decimal;
  lifeInsurance: LifeInsurancePayments;
  earthquakeInsurancePaid: Decimal;
  /** 経過措置（平成18年以前契約の長期損害保険） */
  oldLongTermInsurancePaid: Decimal;
  medicalExpensePaid: Decimal;
  medicalInsuranceReimbursement: Decimal;
  donationAmount: Decimal;
  /** 雑損控除の確定額（利用者が別途算定した値をそのまま入力） */
  casualtyLossDeduction: Decimal;
  isDisabled: boolean;
  isSpecialDisabled: boolean;
  isSingleParent: boolean;
  isWidow: boolean;
  isWorkingStudent: boolean;
  spouse?: SpouseInput;
  dependents: DependentInput[];
}

export interface IncomeDeductionResult {
  basicDeduction: Decimal;
  socialInsuranceDeduction: Decimal;
  smallBusinessMutualAidDeduction: Decimal;
  lifeInsuranceDeduction: Decimal;
  earthquakeInsuranceDeduction: Decimal;
  medicalExpenseDeduction: Decimal;
  donationDeduction: Decimal;
  casualtyLossDeduction: Decimal;
  disabilityDeduction: Decimal;
  singleParentOrWidowDeduction: Decimal;
  workingStudentDeduction: Decimal;
  spouseDeduction: Decimal;
  dependentDeduction: Decimal;
  specificRelativeSpecialDeduction: Decimal;
  total: Decimal;
}

export interface TaxCreditInput {
  dividendDeductionAmount?: Decimal;
  mortgageDeductionAmount?: Decimal;
  politicalDonationCreditAmount?: Decimal;
  housingRenovationCreditAmount?: Decimal;
  foreignTaxCreditAmount?: Decimal;
  otherTaxCreditAmount?: Decimal;
  disasterExemptionAmount?: Decimal;
}

function sum(...values: Decimal[]): Decimal {
  return values.reduce((acc, v) => acc.plus(v), D(0));
}
// 令和7年・8年分限定の基礎控除の暫定加算（措法41条の16の2）。令和9年分以後は
// 2,350万円以下が一律58万円に統一される（下表の655万円超2,350万円以下の欄と同額）。
// 2,350万円超の逓減・消失表（所得税法86条）はこの暫定加算と無関係で変更なし。
const BASIC_DEDUCTION_TEMPORARY_TIERS: Array<[number, number]> = [
  [1_320_000, 950_000],
  [3_360_000, 880_000],
  [4_890_000, 680_000],
  [6_550_000, 630_000],
  [23_500_000, 580_000],
];
const BASIC_DEDUCTION_PERMANENT_TIERS: Array<[number, number]> = [[23_500_000, 580_000]];
const BASIC_DEDUCTION_HIGH_INCOME_TIERS: Array<[number, number]> = [
  [24_000_000, 480_000],
  [24_500_000, 320_000],
  [25_000_000, 160_000],
];

export function basicDeduction(year: number, totalIncome: Decimal): Decimal {
  const tiers = year <= 2026 ? BASIC_DEDUCTION_TEMPORARY_TIERS : BASIC_DEDUCTION_PERMANENT_TIERS;
  for (const [ceiling, amount] of tiers) {
    if (totalIncome.lessThanOrEqualTo(ceiling)) {
      return D(amount);
    }
  }
  for (const [ceiling, amount] of BASIC_DEDUCTION_HIGH_INCOME_TIERS) {
    if (totalIncome.lessThanOrEqualTo(ceiling)) {
      return D(amount);
    }
  }
  return D(0);
}
// 生命保険料控除の1区分（新制度）の計算式（措法76条の2、上限4万円）。
function newLifeInsuranceRow(paid: Decimal): Decimal {
  if (paid.lessThanOrEqualTo(20_000)) {
    return paid;
  }
  if (paid.lessThanOrEqualTo(40_000)) {
    return paid.dividedBy(2).plus(10_000);
  }
  if (paid.lessThanOrEqualTo(80_000)) {
    return paid.dividedBy(4).plus(20_000);
  }
  return D(40_000);
}
// 生命保険料控除の1区分（旧制度）の計算式（上限5万円）。
function oldLifeInsuranceRow(paid: Decimal): Decimal {
  if (paid.lessThanOrEqualTo(25_000)) {
    return paid;
  }
  if (paid.lessThanOrEqualTo(50_000)) {
    return paid.dividedBy(2).plus(12_500);
  }
  if (paid.lessThanOrEqualTo(100_000)) {
    return paid.dividedBy(4).plus(25_000);
  }
  return D(50_000);
}
// 新旧両方の支払いがある区分は、新のみ・旧のみ・新旧合算（上限4万円）のうち最も有利な額を採る。
function lifeInsuranceCategoryAmount(newPaid: Decimal | undefined, oldPaid: Decimal | undefined): Decimal {
  const n = newPaid && newPaid.greaterThan(0) ? newLifeInsuranceRow(newPaid) : D(0);
  const o = oldPaid && oldPaid.greaterThan(0) ? oldLifeInsuranceRow(oldPaid) : D(0);
  if (n.greaterThan(0) && o.greaterThan(0)) {
    const combined = n.plus(o).greaterThan(40_000) ? D(40_000) : n.plus(o);
    return Decimal.max(combined, o.greaterThan(50_000) ? D(50_000) : o);
  }
  return n.greaterThan(0) ? n : o;
}

export function lifeInsuranceDeduction(payments: LifeInsurancePayments): Decimal {
  const general = lifeInsuranceCategoryAmount(payments.newGeneral, payments.oldGeneral);
  const medical = payments.newMedical && payments.newMedical.greaterThan(0)
    ? newLifeInsuranceRow(payments.newMedical)
    : D(0);
  const pension = lifeInsuranceCategoryAmount(payments.newPension, payments.oldPension);
  const total = sum(general, medical, pension);
  return total.greaterThan(120_000) ? D(120_000) : total;
}
// 地震保険料控除（上限5万円）＋経過措置（旧長期損害保険、上限1.5万円）を合算し、合計5万円を上限とする。
export function earthquakeInsuranceDeduction(earthquakePaid: Decimal, oldLongTermPaid: Decimal): Decimal {
  const earthquake = earthquakePaid.greaterThan(50_000) ? D(50_000) : earthquakePaid;
  let oldLongTerm = D(0);
  if (oldLongTermPaid.greaterThan(0)) {
    if (oldLongTermPaid.lessThanOrEqualTo(10_000)) {
      oldLongTerm = oldLongTermPaid;
    } else if (oldLongTermPaid.lessThanOrEqualTo(20_000)) {
      oldLongTerm = oldLongTermPaid.dividedBy(2).plus(5_000);
    } else {
      oldLongTerm = D(15_000);
    }
  }
  const total = earthquake.plus(oldLongTerm);
  return total.greaterThan(50_000) ? D(50_000) : total;
}
// 医療費控除＝(支払医療費−保険金等補填額)−min(10万円, 総所得金額×5%)、下限0・上限200万円。
export function medicalExpenseDeduction(paid: Decimal, reimbursement: Decimal, totalIncome: Decimal): Decimal {
  const net = paid.minus(reimbursement);
  if (net.lessThanOrEqualTo(0)) {
    return D(0);
  }
  const floor = Decimal.min(D(100_000), totalIncome.times(0.05));
  const deduction = net.minus(floor);
  if (deduction.lessThanOrEqualTo(0)) {
    return D(0);
  }
  return deduction.greaterThan(2_000_000) ? D(2_000_000) : deduction;
}
// 寄附金控除＝min(寄附金合計, 総所得金額×40%)−2,000円、下限0。
export function donationDeduction(donationAmount: Decimal, totalIncome: Decimal): Decimal {
  if (donationAmount.lessThanOrEqualTo(0)) {
    return D(0);
  }
  const eligible = Decimal.min(donationAmount, totalIncome.times(0.4));
  const deduction = eligible.minus(2_000);
  return deduction.greaterThan(0) ? deduction : D(0);
}
// 障害者控除（27万円）・特別障害者控除（40万円）。本人のみが対象
// （配偶者・扶養親族の障害者控除、同居特別障害者加算75万円は稀なケースのため対象外）。
export function disabilityDeduction(
  input: Pick<IncomeDeductionInput, 'isDisabled' | 'isSpecialDisabled'>
): Decimal {
  if (input.isSpecialDisabled) {
    return D(400_000);
  }
  if (input.isDisabled) {
    return D(270_000);
  }
  return D(0);
}
// 寡婦控除（27万円）・ひとり親控除（35万円、令和8年分。令和9年分以後38万円）はいずれか一方のみ適用。
export function singleParentOrWidowDeduction(isSingleParent: boolean, isWidow: boolean): Decimal {
  if (isSingleParent) {
    return D(350_000);
  }
  if (isWidow) {
    return D(270_000);
  }
  return D(0);
}

export function workingStudentDeduction(isWorkingStudent: boolean): Decimal {
  return isWorkingStudent ? D(270_000) : D(0);
}

function isElderly(age: number): boolean {
  return age >= 70;
}
// 配偶者の合計所得金額の上限（このラインを超えると配偶者控除・配偶者特別控除とも対象外）。
const SPOUSE_INCOME_CEILING = 1_330_000;
// 配偶者控除の対象となる配偶者の合計所得金額上限。
const SPOUSE_DEDUCTION_INCOME_CEILING = 580_000;
// 配偶者特別控除：[配偶者所得の上限, 納税者900万以下, 900万超950万以下, 950万超1000万以下]
const SPOUSE_SPECIAL_TABLE: Array<[number, number, number, number]> = [
  [950_000, 380_000, 260_000, 130_000],
  [1_000_000, 360_000, 240_000, 120_000],
  [1_050_000, 310_000, 210_000, 110_000],
  [1_100_000, 260_000, 180_000, 90_000],
  [1_150_000, 210_000, 140_000, 70_000],
  [1_200_000, 160_000, 110_000, 60_000],
  [1_250_000, 110_000, 80_000, 40_000],
  [1_300_000, 60_000, 40_000, 20_000],
  [1_330_000, 30_000, 20_000, 10_000],
];

export function spouseDeduction(taxpayerIncome: Decimal, spouse: SpouseInput | undefined): Decimal {
  if (!spouse) {
    return D(0);
  }
  if (taxpayerIncome.greaterThan(10_000_000) || spouse.totalIncome.greaterThan(SPOUSE_INCOME_CEILING)) {
    return D(0);
  }
  const taxpayerTierIndex = taxpayerIncome.lessThanOrEqualTo(9_000_000)
    ? 1
    : taxpayerIncome.lessThanOrEqualTo(9_500_000)
      ? 2
      : 3;
  if (spouse.totalIncome.lessThanOrEqualTo(SPOUSE_DEDUCTION_INCOME_CEILING)) {
    const elderly = isElderly(spouse.age);
    const amounts: Record<number, [number, number]> = {
      1: [380_000, 480_000],
      2: [260_000, 320_000],
      3: [130_000, 160_000],
    };
    const [general, elderlyAmount] = amounts[taxpayerTierIndex]!;
    return D(elderly ? elderlyAmount : general);
  }
  for (const row of SPOUSE_SPECIAL_TABLE) {
    if (spouse.totalIncome.lessThanOrEqualTo(row[0])) {
      return D(row[taxpayerTierIndex]);
    }
  }
  return D(0);
}
// 特定親族特別控除（19歳以上23歳未満、合計所得金額58万円超123万円以下）の控除額表。
const SPECIFIC_RELATIVE_SPECIAL_TABLE: Array<[number, number]> = [
  [850_000, 630_000],
  [900_000, 610_000],
  [950_000, 510_000],
  [1_000_000, 410_000],
  [1_050_000, 310_000],
  [1_100_000, 210_000],
  [1_150_000, 110_000],
  [1_200_000, 60_000],
  [1_230_000, 30_000],
];

function specificRelativeSpecialDeductionAmount(totalIncome: Decimal): Decimal {
  if (totalIncome.lessThanOrEqualTo(SPOUSE_DEDUCTION_INCOME_CEILING) || totalIncome.greaterThan(1_230_000)) {
    return D(0);
  }
  for (const [ceiling, amount] of SPECIFIC_RELATIVE_SPECIAL_TABLE) {
    if (totalIncome.lessThanOrEqualTo(ceiling)) {
      return D(amount);
    }
  }
  return D(0);
}
// 扶養控除の対象となるのは合計所得金額58万円以下の親族のみ。19〜22歳で58万円超123万円以下の
// 親族は扶養控除の対象外となる代わりに特定親族特別控除（別枠）の対象となる。
export function dependentDeductions(dependents: DependentInput[]): {
  dependentDeduction: Decimal;
  specificRelativeSpecialDeduction: Decimal;
} {
  let dependentDeduction = D(0);
  let specificRelativeSpecialDeduction = D(0);
  for (const dep of dependents) {
    if (dep.age >= 19 && dep.age <= 22 && dep.totalIncome.greaterThan(SPOUSE_DEDUCTION_INCOME_CEILING)) {
      specificRelativeSpecialDeduction = specificRelativeSpecialDeduction.plus(
        specificRelativeSpecialDeductionAmount(dep.totalIncome)
      );
      continue;
    }
    if (dep.totalIncome.greaterThan(SPOUSE_DEDUCTION_INCOME_CEILING) || dep.age < 16) {
      continue;
    }
    if (dep.age >= 19 && dep.age <= 22) {
      dependentDeduction = dependentDeduction.plus(630_000);
    } else if (isElderly(dep.age)) {
      dependentDeduction = dependentDeduction.plus(dep.livesWithLinealAscendant ? 580_000 : 480_000);
    } else {
      dependentDeduction = dependentDeduction.plus(380_000);
    }
  }
  return { dependentDeduction, specificRelativeSpecialDeduction };
}

export function computeIncomeDeductions(year: number, input: IncomeDeductionInput): IncomeDeductionResult {
  const { dependentDeduction, specificRelativeSpecialDeduction } = dependentDeductions(input.dependents);
  const result: IncomeDeductionResult = {
    basicDeduction: basicDeduction(year, input.totalIncome),
    socialInsuranceDeduction: input.socialInsurancePaid,
    smallBusinessMutualAidDeduction: input.smallBusinessMutualAidPaid,
    lifeInsuranceDeduction: lifeInsuranceDeduction(input.lifeInsurance),
    earthquakeInsuranceDeduction: earthquakeInsuranceDeduction(input.earthquakeInsurancePaid, input.oldLongTermInsurancePaid),
    medicalExpenseDeduction: medicalExpenseDeduction(input.medicalExpensePaid, input.medicalInsuranceReimbursement, input.totalIncome),
    donationDeduction: donationDeduction(input.donationAmount, input.totalIncome),
    casualtyLossDeduction: input.casualtyLossDeduction,
    disabilityDeduction: disabilityDeduction(input),
    singleParentOrWidowDeduction: singleParentOrWidowDeduction(input.isSingleParent, input.isWidow),
    workingStudentDeduction: workingStudentDeduction(input.isWorkingStudent),
    spouseDeduction: spouseDeduction(input.totalIncome, input.spouse),
    dependentDeduction,
    specificRelativeSpecialDeduction,
    total: D(0),
  };
  result.total = sum(
    result.basicDeduction,
    result.socialInsuranceDeduction,
    result.smallBusinessMutualAidDeduction,
    result.lifeInsuranceDeduction,
    result.earthquakeInsuranceDeduction,
    result.medicalExpenseDeduction,
    result.donationDeduction,
    result.casualtyLossDeduction,
    result.disabilityDeduction,
    result.singleParentOrWidowDeduction,
    result.workingStudentDeduction,
    result.spouseDeduction,
    result.dependentDeduction,
    result.specificRelativeSpecialDeduction
  );
  return result;
}

export function totalTaxCredits(input: TaxCreditInput): Decimal {
  return sum(
    input.dividendDeductionAmount ?? D(0),
    input.mortgageDeductionAmount ?? D(0),
    input.politicalDonationCreditAmount ?? D(0),
    input.housingRenovationCreditAmount ?? D(0),
    input.foreignTaxCreditAmount ?? D(0),
    input.otherTaxCreditAmount ?? D(0)
  );
}
// 課税される所得金額に対する所得税額（速算表、所得税法89条）。taxableIncome は
// 1,000円未満切捨て済みであることを前提とする。
const TAX_BRACKETS: Array<[number, number, number]> = [
  [1_949_000, 0.05, 0],
  [3_299_000, 0.1, 97_500],
  [6_949_000, 0.2, 427_500],
  [8_999_000, 0.23, 636_000],
  [17_999_000, 0.33, 1_536_000],
  [39_999_000, 0.4, 2_796_000],
  [Infinity, 0.45, 4_796_000],
];

export function progressiveIncomeTax(taxableIncome: Decimal): Decimal {
  if (taxableIncome.lessThanOrEqualTo(0)) {
    return D(0);
  }
  const truncated = taxableIncome.dividedBy(1_000).toDecimalPlaces(0, Decimal.ROUND_DOWN).times(1_000);
  for (const [ceiling, rate, deduction] of TAX_BRACKETS) {
    if (truncated.lessThanOrEqualTo(ceiling)) {
      const tax = truncated.times(rate).minus(deduction);
      return (tax.greaterThan(0) ? tax : D(0)).toDecimalPlaces(0, Decimal.ROUND_DOWN);
    }
  }
  return D(0);
}
// 復興特別所得税＝基準所得税額×2.1%（1円未満切捨て）。
export function reconstructionSurtax(baseIncomeTax: Decimal): Decimal {
  return baseIncomeTax.times(0.021).toDecimalPlaces(0, Decimal.ROUND_DOWN);
}