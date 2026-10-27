import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { setSetting } from '../lib/settings';
import {
  findInvalidConsumptionTaxSettings,
  findInvalidStoredAmounts,
  validatePersonalDeductions,
} from './stored-value-checks';
import { m } from '../paraglide/messages';
import type { PersonalDeductionInput } from '../db/types';

function deductions(overrides: Record<string, unknown> = {}): PersonalDeductionInput {
  return {
    year: 2026,
    socialInsurancePaid: '0',
    smallBusinessMutualAidPaid: '0',
    lifeInsurance: {},
    earthquakeInsurancePaid: '0',
    oldLongTermInsurancePaid: '0',
    medicalExpensePaid: '0',
    medicalInsuranceReimbursement: '0',
    donationAmount: '0',
    casualtyLossDeduction: '0',
    isDisabled: false,
    isSpecialDisabled: false,
    isSingleParent: false,
    isWidow: false,
    isWorkingStudent: false,
    dependents: [],
    updatedAt: 1,
    ...overrides,
  } as PersonalDeductionInput;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('validatePersonalDeductions', () => {
  test('正常な値と 15 桁の金額は問題なし', () => {
    expect(validatePersonalDeductions(deductions())).toEqual([]);
    expect(
      validatePersonalDeductions(deductions({ socialInsurancePaid: '200000000000000' })),
    ).toEqual([]);
  });

  test.each([
    ['1e3', '1e3'],
    ['負の値', '-5000'],
    ['abc', 'abc'],
    ['指数表記', '2e+20'],
    ['数値', 5000],
  ])('社会保険料が %s なら欄の名前を返す', (_label, v) => {
    expect(validatePersonalDeductions(deductions({ socialInsurancePaid: v }))).toEqual([
      m.income_deductions_social_insurance_paid(),
    ]);
  });

  test.each([5000, {}, 'abc'])('支払先明細の amount が %j なら表の名前を返す', (amount) => {
    const stored = deductions({
      realEstateIncome: { businessScale: false, rentPaid: [{ amount }] },
    });
    expect(validatePersonalDeductions(stored)).toEqual([
      m.income_deductions_real_estate_rent_paid_title(),
    ]);
  });

  test('年齢が文字列・月数が範囲外なら欄の名前を返す', () => {
    const stored = deductions({
      dependents: [{ id: 'd', name: '', age: '40', totalIncome: '0' }],
      familyEmployees: [{ id: 'f', name: '', relation: 'other', age: 30, monthsWorked: 13 }],
    });
    expect(validatePersonalDeductions(stored)).toEqual([
      m.income_deductions_dependent_age(),
      m.income_deductions_family_employee_months_worked(),
    ]);
  });

  test('lifeInsurance が無い・dependents が配列でないときも例外にせず返す', () => {
    const stored = deductions({ lifeInsurance: undefined, dependents: 'x' });
    expect(validatePersonalDeductions(stored)).toEqual([
      m.income_deductions_insurance_title(),
      m.income_deductions_dependents_title(),
    ]);
    expect(validatePersonalDeductions(null)).toEqual([m.income_deductions_title()]);
  });
});

describe('findInvalidConsumptionTaxSettings', () => {
  test('数値で保存された基準期間の課税売上高・読めない 2 割特例の金額は設定名を返す', async () => {
    await setSetting('basePeriodTaxableSales', 20000000 as unknown as string);
    await setSetting('wariBaseAdjustments', {
      2026: {
        salesReturnTax78: 'abc',
        specifiedSmallAssetTransfers: [{ date: '2026-05-01', rate: 0.1, netTax: '1e3' }],
      },
    });
    expect(await findInvalidConsumptionTaxSettings(2026)).toEqual([
      m.settings_ct_base_period_sales(),
      m.reports_wari_sales_return_tax_78(),
      m.reports_wari_specified_small_asset_transfers(),
    ]);
  });

  test('15 桁の netTax と空の設定は問題なし', async () => {
    await setSetting('wariBaseAdjustments', {
      2026: {
        specifiedSmallAssetTransfers: [
          { date: '2026-05-01', rate: 0.1, netTax: '200000000000000' },
        ],
      },
    });
    expect(await findInvalidConsumptionTaxSettings(2026)).toEqual([]);
  });
});

describe('findInvalidStoredAmounts', () => {
  test('所得税側は所得控除と固定資産を見る', async () => {
    await db.personalDeductions.put(deductions({ socialInsurancePaid: '-5000' }));
    await db.fixedAssets.add({
      id: 'a',
      name: '壊れた資産',
      acquisitionDate: '2026-01-01',
      acquisitionCost: 'abc',
      usefulLifeYears: 4,
      depreciationMethod: 'straight-line',
      accountCode: '1510',
    });
    const found = await findInvalidStoredAmounts(2026, 'income');
    expect(found[0]).toBe(m.income_deductions_social_insurance_paid());
    expect(found[1]).toContain('壊れた資産');
    expect(await findInvalidStoredAmounts(2026, 'consumption')).toEqual([]);
  });
});
