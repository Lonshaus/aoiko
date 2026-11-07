import { describe, expect, test } from 'vitest';
import type { FixedAsset, PersonalDeductionInput } from '../../db/types';
import { hasInvalidXtxAmounts, hasInvalidXtxPropertyText } from './xtx-amount-check';

function baseDeductions(): PersonalDeductionInput {
  return {
    year: 2026,
    socialInsurancePaid: '100',
    smallBusinessMutualAidPaid: '100',
    lifeInsurance: {
      newGeneral: '100',
      oldGeneral: '100',
      newMedical: '100',
      newPension: '100',
      oldPension: '100',
    },
    earthquakeInsurancePaid: '100',
    oldLongTermInsurancePaid: '100',
    medicalExpensePaid: '100',
    medicalInsuranceReimbursement: '100',
    donationAmount: '100',
    casualtyLossDeduction: '100',
    isDisabled: false,
    isSpecialDisabled: false,
    isSingleParent: false,
    isWidow: false,
    isWorkingStudent: false,
    spouse: { totalIncome: '100', age: 40 },
    dependents: [{ id: 'd1', name: '扶養A', age: 20, totalIncome: '100' }],
    dividendDeductionAmount: '100',
    mortgageDeductionAmount: '100',
    politicalDonationCreditAmount: '100',
    housingRenovationCreditAmount: '100',
    foreignTaxCreditAmount: '100',
    otherTaxCreditAmount: '100',
    disasterExemptionAmount: '100',
    salaryIncome: { paidAmount: '100', withholdingTax: '100' },
    miscIncome: {
      publicPensionAmount: '100',
      publicPensionRevenue: '100',
      otherIncome: '100',
      otherExpenses: '100',
    },
    otherWithholdingTax: '100',
    realEstateIncome: {
      businessScale: true,
      landLoanInterestAmount: '100',
      rentPaid: [{ amount: '100', deductibleAmount: '100' }],
      loanInterestPaid: [{ amount: '100', deductibleAmount: '100', yearEndBalance: '100' }],
      professionalFeesPaid: [{ amount: '100', deductibleAmount: '100', withholdingTax: '100' }],
    },
    priorPriorBusinessRevenue: '100',
    priorPriorRealEstateRevenue: '100',
    updatedAt: 0,
  };
}

function baseAsset(): FixedAsset {
  return {
    id: 'a1',
    name: '賃貸物件',
    acquisitionDate: '2026-01-01',
    acquisitionCost: '1000000',
    usefulLifeYears: 10,
    depreciationMethod: 'straight-line',
    accountCode: '1510',
    incomeType: 'realEstate',
    salePrice: '100',
    saleExpenses: '100',
    realEstateDetail: {
      propertyType: '貸家',
      address: '東京都',
      annualRent: '100',
      keyMoneyEtc: '100',
      otherIncome: '100',
      depositBalance: '100',
    },
  };
}

function setPath(target: object, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  let node = target as Record<string, unknown>;
  for (const key of keys) {
    node = node[key] as Record<string, unknown>;
  }
  node[last] = value;
}

function withValue(path: string, value: unknown, mode?: 'revenue'): PersonalDeductionInput {
  const stored = baseDeductions();
  if (mode !== undefined) {
    stored.miscIncome!.publicPensionInputMode = mode;
  }
  setPath(stored, path, value);
  return stored;
}

function invalidWith(path: string, value: unknown, mode?: 'revenue'): boolean {
  return hasInvalidXtxAmounts(withValue(path, value, mode), [], true);
}

const DEDUCTION_PATHS = [
  'socialInsurancePaid',
  'smallBusinessMutualAidPaid',
  'earthquakeInsurancePaid',
  'oldLongTermInsurancePaid',
  'medicalExpensePaid',
  'medicalInsuranceReimbursement',
  'donationAmount',
  'casualtyLossDeduction',
  'lifeInsurance.newGeneral',
  'lifeInsurance.oldGeneral',
  'lifeInsurance.newMedical',
  'lifeInsurance.newPension',
  'lifeInsurance.oldPension',
  'spouse.totalIncome',
  'dependents.0.totalIncome',
  'dividendDeductionAmount',
  'mortgageDeductionAmount',
  'politicalDonationCreditAmount',
  'housingRenovationCreditAmount',
  'foreignTaxCreditAmount',
  'otherTaxCreditAmount',
  'disasterExemptionAmount',
  'salaryIncome.paidAmount',
  'salaryIncome.withholdingTax',
  'miscIncome.publicPensionAmount',
  'miscIncome.otherIncome',
  'miscIncome.otherExpenses',
  'otherWithholdingTax',
  'realEstateIncome.landLoanInterestAmount',
  'realEstateIncome.rentPaid.0.amount',
  'realEstateIncome.rentPaid.0.deductibleAmount',
  'realEstateIncome.loanInterestPaid.0.amount',
  'realEstateIncome.loanInterestPaid.0.deductibleAmount',
  'realEstateIncome.loanInterestPaid.0.yearEndBalance',
  'realEstateIncome.professionalFeesPaid.0.amount',
  'realEstateIncome.professionalFeesPaid.0.deductibleAmount',
  'realEstateIncome.professionalFeesPaid.0.withholdingTax',
  'priorPriorBusinessRevenue',
  'priorPriorRealEstateRevenue',
];

const OPTIONAL_DEDUCTION_PATHS = [
  'lifeInsurance.newGeneral',
  'lifeInsurance.oldGeneral',
  'lifeInsurance.newMedical',
  'lifeInsurance.newPension',
  'lifeInsurance.oldPension',
  'dividendDeductionAmount',
  'mortgageDeductionAmount',
  'politicalDonationCreditAmount',
  'housingRenovationCreditAmount',
  'foreignTaxCreditAmount',
  'otherTaxCreditAmount',
  'disasterExemptionAmount',
  'miscIncome.publicPensionAmount',
  'miscIncome.publicPensionRevenue',
  'miscIncome.otherIncome',
  'miscIncome.otherExpenses',
  'otherWithholdingTax',
  'priorPriorBusinessRevenue',
  'priorPriorRealEstateRevenue',
  'realEstateIncome.landLoanInterestAmount',
  'realEstateIncome.rentPaid.0.deductibleAmount',
  'realEstateIncome.loanInterestPaid.0.deductibleAmount',
  'realEstateIncome.loanInterestPaid.0.yearEndBalance',
  'realEstateIncome.professionalFeesPaid.0.deductibleAmount',
  'realEstateIncome.professionalFeesPaid.0.withholdingTax',
];

describe('hasInvalidXtxAmounts: 所得控除の金額欄', () => {
  test('すべて整数か空欄なら false', () => {
    expect(hasInvalidXtxAmounts(baseDeductions(), [], true)).toBe(false);
    const empty = baseDeductions();
    for (const path of DEDUCTION_PATHS) {
      setPath(empty, path, '');
    }
    expect(hasInvalidXtxAmounts(empty, [], true)).toBe(false);
  });

  test('小数部分が 0 の値と全角・桁区切りの整数は誤りに数えない', () => {
    expect(invalidWith('socialInsurancePaid', '100.0')).toBe(false);
    expect(invalidWith('socialInsurancePaid', '１，０００')).toBe(false);
  });

  test.each(DEDUCTION_PATHS)('%s が小数なら true', (path) => {
    expect(hasInvalidXtxAmounts(withValue(path, '100.5'), [], true)).toBe(true);
  });

  test.each(DEDUCTION_PATHS)('%s が読めない値なら true', (path) => {
    expect(hasInvalidXtxAmounts(withValue(path, 'abc'), [], true)).toBe(true);
  });

  test('収入金額方式の公的年金は publicPensionRevenue の小数だけを見る', () => {
    expect(invalidWith('miscIncome.publicPensionRevenue', '100.5', 'revenue')).toBe(true);
    expect(invalidWith('miscIncome.publicPensionRevenue', 'abc', 'revenue')).toBe(true);
    expect(invalidWith('miscIncome.publicPensionAmount', '100.5', 'revenue')).toBe(false);
  });

  test('直接入力方式の公的年金は publicPensionRevenue の小数を読まない', () => {
    expect(invalidWith('miscIncome.publicPensionRevenue', '100.5')).toBe(false);
  });

  test('事業専従者と同一人物の配偶者・扶養親族の合計所得は読まれないので見ない', () => {
    const stored = withValue('spouse.totalIncome', '100.5');
    stored.dependents[0]!.totalIncome = '100.5';
    expect(hasInvalidXtxAmounts(stored, [], true)).toBe(true);
    stored.familyEmployees = [
      { id: 'f1', name: '配偶者', relation: 'spouse', age: 40, monthsWorked: 12 },
      { id: 'f2', name: '扶養A', relation: 'other', age: 20, monthsWorked: 12 },
    ];
    expect(hasInvalidXtxAmounts(stored, [], true)).toBe(false);
  });

  test('任意の欄が未設定なら見ない', () => {
    const stored = baseDeductions();
    for (const path of OPTIONAL_DEDUCTION_PATHS) {
      setPath(stored, path, undefined);
    }
    expect(hasInvalidXtxAmounts(stored, [], true)).toBe(false);
    delete stored.spouse;
    delete stored.salaryIncome;
    delete stored.miscIncome;
    delete stored.realEstateIncome;
    expect(hasInvalidXtxAmounts(stored, [], true)).toBe(false);
  });

  test.each(DEDUCTION_PATHS)('%s が文字列でない値なら例外を投げず true', (path) => {
    expect(hasInvalidXtxAmounts(withValue(path, 100.5), [], true)).toBe(true);
    expect(hasInvalidXtxAmounts(withValue(path, null), [], true)).toBe(true);
  });

  test('収入金額方式の公的年金で publicPensionRevenue が文字列でなければ true', () => {
    expect(invalidWith('miscIncome.publicPensionRevenue', 100.5, 'revenue')).toBe(true);
  });

  test('必須の欄が欠けている保存値（手編集）も例外を投げず true', () => {
    expect(invalidWith('socialInsurancePaid', undefined)).toBe(true);
  });
});

describe('hasInvalidXtxAmounts: 固定資産の金額欄', () => {
  const ASSET_PATHS = [
    'realEstateDetail.annualRent',
    'realEstateDetail.keyMoneyEtc',
    'realEstateDetail.otherIncome',
    'realEstateDetail.depositBalance',
  ];

  function assetWith(path: string, value: unknown): FixedAsset {
    const asset = baseAsset();
    setPath(asset, path, value);
    return asset;
  }

  test('所得控除が未保存で資産に問題がなければ false', () => {
    expect(hasInvalidXtxAmounts(undefined, [], true)).toBe(false);
    expect(hasInvalidXtxAmounts(undefined, [baseAsset()], true)).toBe(false);
  });

  test('任意の欄が未設定の資産は false', () => {
    const asset = baseAsset();
    delete asset.salePrice;
    delete asset.saleExpenses;
    delete asset.realEstateDetail;
    expect(hasInvalidXtxAmounts(undefined, [asset], true)).toBe(false);
  });

  test.each(ASSET_PATHS)('%s が小数なら true', (path) => {
    expect(hasInvalidXtxAmounts(undefined, [baseAsset(), assetWith(path, '100.5')], true)).toBe(
      true,
    );
  });

  test.each(ASSET_PATHS)('%s が読めない値なら true', (path) => {
    expect(hasInvalidXtxAmounts(undefined, [assetWith(path, 'abc')], true)).toBe(true);
  });

  test.each(ASSET_PATHS)('%s が文字列でない値なら例外を投げず true', (path) => {
    expect(hasInvalidXtxAmounts(undefined, [assetWith(path, 100.5)], true)).toBe(true);
  });

  test.each([
    ['小数', '100.5'],
    ['読めない値', 'abc'],
    ['文字列でない値', 100.5],
  ])('salePrice・saleExpenses は検査しない（%s）', (_label, value) => {
    expect(hasInvalidXtxAmounts(undefined, [assetWith('salePrice', value)], true)).toBe(false);
    expect(hasInvalidXtxAmounts(undefined, [assetWith('saleExpenses', value)], true)).toBe(false);
  });

  test('salePrice が小数、saleExpenses が読めない値の資産も false', () => {
    const asset = baseAsset();
    asset.salePrice = '100.5';
    asset.saleExpenses = 'abc';
    expect(hasInvalidXtxAmounts(undefined, [asset], true)).toBe(false);
  });

  test('物件明細は incomeType が realEstate の資産だけを見る', () => {
    const business = baseAsset();
    business.incomeType = 'business';
    business.realEstateDetail!.annualRent = '100.5';
    expect(hasInvalidXtxAmounts(undefined, [business], true)).toBe(false);
  });

  test('所得控除に問題がなくても資産に問題があれば true、逆も同じ', () => {
    expect(
      hasInvalidXtxAmounts(
        baseDeductions(),
        [assetWith('realEstateDetail.annualRent', '100.5')],
        true,
      ),
    ).toBe(true);
    expect(hasInvalidXtxAmounts(withValue('donationAmount', '100.5'), [baseAsset()], true)).toBe(
      true,
    );
  });
});

describe('hasInvalidXtxAmounts: 不動産所得が無効のとき', () => {
  const REAL_ESTATE_PATHS = DEDUCTION_PATHS.filter(
    (path) => path.startsWith('realEstateIncome.') && path !== 'priorPriorRealEstateRevenue',
  );

  test.each(REAL_ESTATE_PATHS)('%s が小数でも false', (path) => {
    expect(hasInvalidXtxAmounts(withValue(path, '100.5'), [], false)).toBe(false);
  });

  test.each(REAL_ESTATE_PATHS)('%s が読めない値でも false', (path) => {
    expect(hasInvalidXtxAmounts(withValue(path, 'abc'), [], false)).toBe(false);
  });

  test('realEstateIncome の欄の一覧が空でない', () => {
    expect(REAL_ESTATE_PATHS.length).toBeGreaterThan(0);
  });

  test('資産の物件明細が小数でも false', () => {
    const asset = baseAsset();
    asset.realEstateDetail!.annualRent = '100.5';
    expect(hasInvalidXtxAmounts(undefined, [asset], false)).toBe(false);
  });

  test('priorPriorRealEstateRevenue は不動産所得に関係なく検査する', () => {
    expect(hasInvalidXtxAmounts(withValue('priorPriorRealEstateRevenue', '100.5'), [], false)).toBe(
      true,
    );
  });

  test('不動産所得に関係ない欄は無効でも検査する', () => {
    expect(hasInvalidXtxAmounts(withValue('socialInsurancePaid', '100.5'), [], false)).toBe(true);
  });
});

describe('hasInvalidXtxPropertyText: 物件明細の文字欄', () => {
  function assetWithDetail(path: string, value: unknown): FixedAsset {
    const asset = baseAsset();
    setPath(asset, `realEstateDetail.${path}`, value);
    return asset;
  }

  test('propertyType が数値で不動産所得が有効なら true、無効なら false', () => {
    const asset = assetWithDetail('propertyType', 123);
    expect(hasInvalidXtxPropertyText([asset], true)).toBe(true);
    expect(hasInvalidXtxPropertyText([asset], false)).toBe(false);
  });

  test('address が数値なら true', () => {
    expect(hasInvalidXtxPropertyText([assetWithDetail('address', 123)], true)).toBe(true);
  });

  test.each(['tenantName', 'tenantAddress', 'rentalPeriodStart', 'rentalPeriodEnd'])(
    '%s が数値なら true',
    (key) => {
      expect(hasInvalidXtxPropertyText([assetWithDetail(key, 123)], true)).toBe(true);
    },
  );

  test('areaSqm が数値（45）なら true、不動産所得が無効なら false', () => {
    const asset = assetWithDetail('areaSqm', 45);
    expect(hasInvalidXtxPropertyText([asset], true)).toBe(true);
    expect(hasInvalidXtxPropertyText([asset], false)).toBe(false);
  });

  test('realEstateDetail が null の資産は、有効でも無効でも例外を投げず false', () => {
    const asset = baseAsset();
    setPath(asset, 'realEstateDetail', null);
    expect(hasInvalidXtxAmounts(undefined, [asset], true)).toBe(false);
    expect(hasInvalidXtxAmounts(undefined, [asset], false)).toBe(false);
    expect(hasInvalidXtxPropertyText([asset], true)).toBe(false);
    expect(hasInvalidXtxPropertyText([asset], false)).toBe(false);
  });

  test('realEstateDetail が文字列なら true（金額の検査は例外を投げず true）', () => {
    const asset = baseAsset();
    setPath(asset, 'realEstateDetail', 'x');
    expect(hasInvalidXtxPropertyText([asset], true)).toBe(true);
    expect(hasInvalidXtxAmounts(undefined, [asset], true)).toBe(true);
  });

  test('incomeType が realEstate でない資産の数値 propertyType は見ない', () => {
    const asset = assetWithDetail('propertyType', 123);
    asset.incomeType = 'business';
    expect(hasInvalidXtxPropertyText([asset], true)).toBe(false);
  });

  test('文字欄がすべて文字列、任意の欄が無い資産は false', () => {
    const asset = baseAsset();
    expect(hasInvalidXtxPropertyText([asset], true)).toBe(false);
    asset.realEstateDetail = { ...asset.realEstateDetail!, tenantName: '山田', areaSqm: '45' };
    expect(hasInvalidXtxPropertyText([asset], true)).toBe(false);
  });
});
