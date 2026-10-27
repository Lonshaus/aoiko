import { db } from '../db/db';
import { normalizeAmountInput, parseAmountInput, parseIntegerInput } from '../lib/amount-input';
import { getSetting } from '../lib/settings';
import { describeInvalidFixedAssets, findInvalidFixedAssets } from './fixed-asset-check';
import {
  buildDepreciationInputs,
  computeYearDepreciationAll,
  loadEffectiveBusinessDates,
} from './depreciation';
import { m } from '../paraglide/messages';

const AGE_RANGE = { min: 0, max: 120 };
const MONTHS_RANGE = { min: 0, max: 12 };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
// 読む側（toDec・toRowAmount・settings.ts）は parseAmountInput で読み、読めなければ 0 や未記入にしてしまう。
// 黙って別の値で出力しないよう、同じ読み方で読めない値を先に見つける。未指定は空欄と同じ扱い
function isStoredAmountInvalid(v: unknown): boolean {
  if (v === undefined) {
    return false;
  }
  if (typeof v !== 'string') {
    return true;
  }
  return normalizeAmountInput(v) !== '' && parseAmountInput(v) === undefined;
}

function isStoredIntegerInvalid(v: unknown, range: { min: number; max: number }): boolean {
  return typeof v !== 'number' || parseIntegerInput(String(v), range) === undefined;
}

const TOP_LEVEL_AMOUNTS: [string, () => string][] = [
  ['socialInsurancePaid', m.income_deductions_social_insurance_paid],
  ['smallBusinessMutualAidPaid', m.income_deductions_small_business_mutual_aid_paid],
  ['earthquakeInsurancePaid', m.income_deductions_earthquake_insurance_paid],
  ['oldLongTermInsurancePaid', m.income_deductions_old_long_term_insurance_paid],
  ['medicalExpensePaid', m.income_deductions_medical_expense_paid],
  ['medicalInsuranceReimbursement', m.income_deductions_medical_insurance_reimbursement],
  ['donationAmount', m.income_deductions_donation_amount],
  ['casualtyLossDeduction', m.income_deductions_casualty_loss_deduction],
  ['dividendDeductionAmount', m.income_deductions_dividend_credit],
  ['mortgageDeductionAmount', m.income_deductions_mortgage_credit],
  ['politicalDonationCreditAmount', m.income_deductions_political_donation_credit],
  ['housingRenovationCreditAmount', m.income_deductions_housing_renovation_credit],
  ['foreignTaxCreditAmount', m.income_deductions_foreign_tax_credit],
  ['otherTaxCreditAmount', m.income_deductions_other_tax_credit],
  ['disasterExemptionAmount', m.income_deductions_disaster_exemption],
  ['otherWithholdingTax', m.income_deductions_other_withholding_tax],
  ['priorPriorBusinessRevenue', m.income_prior_prior_business_revenue],
  ['priorPriorRealEstateRevenue', m.income_prior_prior_real_estate_revenue],
];

const LIFE_INSURANCE_AMOUNTS: [string, () => string][] = [
  ['newGeneral', m.income_deductions_life_insurance_new_general],
  ['oldGeneral', m.income_deductions_life_insurance_old_general],
  ['newMedical', m.income_deductions_life_insurance_new_medical],
  ['newPension', m.income_deductions_life_insurance_new_pension],
  ['oldPension', m.income_deductions_life_insurance_old_pension],
];

const PAYEE_TABLES: [string, () => string][] = [
  ['rentPaid', m.income_deductions_real_estate_rent_paid_title],
  ['loanInterestPaid', m.income_deductions_real_estate_loan_interest_paid_title],
  ['professionalFeesPaid', m.income_deductions_real_estate_professional_fees_title],
];
// 復元された所得控除は主キーしか検査していない。.xtx の変換（personalDeductionsToCtx）が例外にする形と、
// 0 や未記入に置き換えてしまう金額・年齢・月数を、読めない欄の名前の一覧として返す
export function validatePersonalDeductions(stored: unknown): string[] {
  if (!isRecord(stored)) {
    return [m.income_deductions_title()];
  }
  const bad: string[] = [];
  for (const [key, label] of TOP_LEVEL_AMOUNTS) {
    if (isStoredAmountInvalid(stored[key])) {
      bad.push(label());
    }
  }
  const life = stored.lifeInsurance;
  if (!isRecord(life)) {
    bad.push(m.income_deductions_insurance_title());
  } else {
    for (const [key, label] of LIFE_INSURANCE_AMOUNTS) {
      if (isStoredAmountInvalid(life[key])) {
        bad.push(label());
      }
    }
  }
  const spouse = stored.spouse;
  if (spouse !== undefined && spouse !== null && spouse !== false) {
    if (!isRecord(spouse) || isStoredAmountInvalid(spouse.totalIncome)) {
      bad.push(m.income_deductions_spouse_income());
    }
    if (!isRecord(spouse) || isStoredIntegerInvalid(spouse.age, AGE_RANGE)) {
      bad.push(m.income_deductions_spouse_age());
    }
  }
  const dependents = stored.dependents;
  if (!Array.isArray(dependents)) {
    bad.push(m.income_deductions_dependents_title());
  } else {
    for (const d of dependents as unknown[]) {
      if (!isRecord(d) || isStoredAmountInvalid(d.totalIncome)) {
        bad.push(m.income_deductions_dependent_income());
      }
      if (!isRecord(d) || isStoredIntegerInvalid(d.age, AGE_RANGE)) {
        bad.push(m.income_deductions_dependent_age());
      }
    }
  }
  const familyEmployees = stored.familyEmployees;
  if (familyEmployees !== undefined) {
    if (!Array.isArray(familyEmployees)) {
      bad.push(m.income_deductions_family_employees_title());
    } else {
      for (const f of familyEmployees as unknown[]) {
        if (!isRecord(f) || isStoredIntegerInvalid(f.age, AGE_RANGE)) {
          bad.push(m.income_deductions_family_employee_age());
        }
        if (!isRecord(f) || isStoredIntegerInvalid(f.monthsWorked, MONTHS_RANGE)) {
          bad.push(m.income_deductions_family_employee_months_worked());
        }
      }
    }
  }
  const salary = stored.salaryIncome;
  if (salary) {
    if (!isRecord(salary) || isStoredAmountInvalid(salary.paidAmount)) {
      bad.push(m.income_deductions_salary_paid_amount());
    }
    if (!isRecord(salary) || isStoredAmountInvalid(salary.withholdingTax)) {
      bad.push(m.income_deductions_salary_withholding_tax());
    }
  }
  const misc = stored.miscIncome;
  if (misc) {
    const r = isRecord(misc) ? misc : {};
    for (const [key, label] of [
      ['publicPensionAmount', m.income_deductions_public_pension_amount],
      ['otherIncome', m.income_deductions_other_misc_income],
      ['otherExpenses', m.income_deductions_other_misc_expenses],
    ] as const) {
      if (!isRecord(misc) || isStoredAmountInvalid(r[key])) {
        bad.push(label());
      }
    }
  }
  const realEstate = stored.realEstateIncome;
  if (realEstate) {
    if (!isRecord(realEstate)) {
      bad.push(m.income_deductions_real_estate_title());
    } else {
      if (isStoredAmountInvalid(realEstate.landLoanInterestAmount)) {
        bad.push(m.income_deductions_real_estate_land_loan_interest());
      }
      for (const [key, label] of PAYEE_TABLES) {
        const rows = realEstate[key];
        if (!rows) {
          continue;
        }
        const ok =
          Array.isArray(rows) &&
          (rows as unknown[]).every(
            (row) =>
              isRecord(row) &&
              typeof row.amount === 'string' &&
              !isStoredAmountInvalid(row.amount) &&
              !isStoredAmountInvalid(row.deductibleAmount) &&
              !isStoredAmountInvalid(row.yearEndBalance) &&
              !isStoredAmountInvalid(row.withholdingTax),
          );
        if (!ok) {
          bad.push(label());
        }
      }
    }
  }
  return [...new Set(bad)];
}
// 消費税の判定・.xtx・弥生 CSV が settings.ts 経由で読む金額設定。読めない値は「未設定」として黙って判定を変えてしまう
export async function findInvalidConsumptionTaxSettings(year: number): Promise<string[]> {
  const bad: string[] = [];
  if (isStoredAmountInvalid(await getSetting('basePeriodTaxableSales'))) {
    bad.push(m.settings_ct_base_period_sales());
  }
  if (isStoredAmountInvalid(await getSetting('specifiedPeriodTaxableSales'))) {
    bad.push(m.settings_ct_specified_period_sales());
  }
  const map: unknown = await getSetting('wariBaseAdjustments');
  const stored = isRecord(map) ? map[year] : undefined;
  if (isRecord(stored)) {
    if (isStoredAmountInvalid(stored.salesReturnTax78)) {
      bad.push(m.reports_wari_sales_return_tax_78());
    }
    if (isStoredAmountInvalid(stored.salesReturnTax624)) {
      bad.push(m.reports_wari_sales_return_tax_624());
    }
    const rows: unknown = stored.specifiedSmallAssetTransfers;
    if (
      Array.isArray(rows) &&
      (rows as unknown[]).some((t) => isRecord(t) && isStoredAmountInvalid(t.netTax))
    ) {
      bad.push(m.reports_wari_specified_small_asset_transfers());
    }
  }
  return bad;
}
// .xtx を出す前に、保存済みの値のうち出力が黙って 0・未記入・例外になるものを並べる。
// income は所得税（所得控除・固定資産）、consumption は消費税の設定を見る
export async function findInvalidStoredAmounts(
  year: number,
  scope: 'income' | 'consumption',
): Promise<string[]> {
  if (scope === 'consumption') {
    return findInvalidConsumptionTaxSettings(year);
  }
  const found: string[] = [];
  const stored = await db.personalDeductions.get(year);
  if (stored !== undefined) {
    found.push(...validatePersonalDeductions(stored));
  }
  const assets = await db.fixedAssets.toArray();
  const invalidAssets = findInvalidFixedAssets(assets);
  if (invalidAssets.length > 0) {
    found.push(describeInvalidFixedAssets(invalidAssets));
    return found;
  }
  // 値が読めても計算できない資産（少額特例の落選で率表に無い耐用年数になる等）は .xtx の組み立て中に投げる。
  // 償却仕訳の生成と同じ計算を先に通し、資産の名前付きで示す
  try {
    const dates = await loadEffectiveBusinessDates();
    const inputs = buildDepreciationInputs(
      assets,
      dates.businessStartDates,
      dates.businessCloseDate,
    );
    computeYearDepreciationAll(assets, year, inputs);
  } catch (e) {
    found.push(e instanceof Error ? e.message : String(e));
  }
  return found;
}

export class InvalidStoredValuesError extends Error {
  constructor(items: readonly string[]) {
    super(m.stored_values_invalid({ items: items.join('、') }));
    this.name = 'InvalidStoredValuesError';
  }
}
