import type { FixedAsset, PersonalDeductionInput } from '../../db/types';
import { isAmountInputMalformed, parseAmountInput } from '../../lib/amount-input';
import { familyEmployeeExclusion } from './family-employee-deduction';
// 手編集されたバックアップの文字列以外の値は、personalDeductionsToCtx が 0 扱いかそのまま通すため誤りに数える。
// 小数は大きさを問わず誤りに数える。100 兆円以上の整数は 15 桁以内なら .xtx に書けるので数えない
function invalid(value: unknown): boolean {
  if (typeof value !== 'string' || isAmountInputMalformed(value)) {
    return true;
  }
  return parseAmountInput(value)?.isInteger() === false;
}

function invalidIfPresent(value: unknown): boolean {
  return value !== undefined && invalid(value);
}

function rowsInvalid<T extends { amount: string; deductibleAmount?: string }>(
  rows: T[] | undefined,
  extra: (row: T) => unknown = () => undefined,
): boolean {
  return (rows ?? []).some(
    (r) => invalid(r.amount) || invalidIfPresent(r.deductibleAmount) || invalidIfPresent(extra(r)),
  );
}
// personalDeductionsToCtx が実際に読む金額欄だけを対象にする（読まれない欄は出力に影響しない）
function deductionsInvalid(
  stored: PersonalDeductionInput,
  realEstateIncomeEnabled: boolean,
): boolean {
  const exclusion = familyEmployeeExclusion(stored.familyEmployees ?? [], stored.dependents);
  const life = stored.lifeInsurance;
  const misc = stored.miscIncome;
  const realEstate = stored.realEstateIncome;
  return (
    [
      stored.socialInsurancePaid,
      stored.smallBusinessMutualAidPaid,
      stored.earthquakeInsurancePaid,
      stored.oldLongTermInsurancePaid,
      stored.medicalExpensePaid,
      stored.medicalInsuranceReimbursement,
      stored.donationAmount,
      stored.casualtyLossDeduction,
    ].some(invalid) ||
    [
      life.newGeneral,
      life.oldGeneral,
      life.newMedical,
      life.newPension,
      life.oldPension,
      stored.dividendDeductionAmount,
      stored.mortgageDeductionAmount,
      stored.politicalDonationCreditAmount,
      stored.housingRenovationCreditAmount,
      stored.foreignTaxCreditAmount,
      stored.otherTaxCreditAmount,
      stored.disasterExemptionAmount,
      stored.otherWithholdingTax,
      stored.priorPriorBusinessRevenue,
      stored.priorPriorRealEstateRevenue,
    ].some(invalidIfPresent) ||
    (stored.spouse !== undefined &&
      !exclusion.spouseExcluded &&
      invalid(stored.spouse.totalIncome)) ||
    stored.dependents.some(
      (d) => !exclusion.excludedDependentIds.has(d.id) && invalid(d.totalIncome),
    ) ||
    (stored.salaryIncome !== undefined &&
      (invalid(stored.salaryIncome.paidAmount) || invalid(stored.salaryIncome.withholdingTax))) ||
    (misc !== undefined &&
      ((misc.publicPensionInputMode === 'revenue'
        ? invalidIfPresent(misc.publicPensionRevenue)
        : invalidIfPresent(misc.publicPensionAmount)) ||
        invalidIfPresent(misc.otherIncome) ||
        invalidIfPresent(misc.otherExpenses))) ||
    (realEstateIncomeEnabled &&
      realEstate !== undefined &&
      (invalidIfPresent(realEstate.landLoanInterestAmount) ||
        rowsInvalid(realEstate.rentPaid) ||
        rowsInvalid(realEstate.loanInterestPaid, (r) => r.yearEndBalance) ||
        rowsInvalid(realEstate.professionalFeesPaid, (r) => r.withholdingTax)))
  );
}

function fixedAssetsInvalid(fixedAssets: FixedAsset[]): boolean {
  return fixedAssets.some((a) => {
    const detail = a.realEstateDetail;
    return (
      a.incomeType === 'realEstate' &&
      detail !== undefined &&
      detail !== null &&
      (invalid(detail.annualRent) ||
        invalidIfPresent(detail.keyMoneyEtc) ||
        invalidIfPresent(detail.otherIncome) ||
        invalidIfPresent(detail.depositBalance))
    );
  });
}
// 読めない値・小数を含む値は .xtx の各欄で 0 や切り捨てに変わるため、出力の前に見つけて止める。
// 不動産所得が無効のときは realEstateIncome と物件明細が出力に使われないので検査しない
export function hasInvalidXtxAmounts(
  stored: PersonalDeductionInput | undefined,
  fixedAssets: FixedAsset[],
  realEstateIncomeEnabled: boolean,
): boolean {
  return (
    (stored !== undefined && deductionsInvalid(stored, realEstateIncomeEnabled)) ||
    (realEstateIncomeEnabled && fixedAssetsInvalid(fixedAssets))
  );
}

const OPTIONAL_TEXT_KEYS = [
  'tenantName',
  'tenantAddress',
  'rentalPeriodStart',
  'rentalPeriodEnd',
  'areaSqm',
];
// 物件明細の文字欄は KOA220／KOA130 が文字列として切り詰め・置換するため、文字列以外は例外になる。
// realEstateDetail が null のものは KOA の絞り込み（真値のみ）に掛からず出力に使われない
export function hasInvalidXtxPropertyText(
  fixedAssets: FixedAsset[],
  realEstateIncomeEnabled: boolean,
): boolean {
  if (!realEstateIncomeEnabled) {
    return false;
  }
  return fixedAssets.some((a) => {
    const detail: unknown = a.realEstateDetail;
    if (a.incomeType !== 'realEstate' || detail === undefined || detail === null) {
      return false;
    }
    if (typeof detail !== 'object') {
      return true;
    }
    const d = detail as Record<string, unknown>;
    return (
      typeof d.propertyType !== 'string' ||
      typeof d.address !== 'string' ||
      OPTIONAL_TEXT_KEYS.some((k) => d[k] !== undefined && typeof d[k] !== 'string')
    );
  });
}
