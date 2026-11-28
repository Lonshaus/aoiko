import { describe, expect, test } from 'vitest';
import { validatePersonalDeductions } from './stored-value-checks';
import { m } from '../paraglide/messages';
import type { PersonalDeductionInput } from '../db/types';

function deductions(filingNotices: unknown): PersonalDeductionInput {
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
    ...(filingNotices === undefined ? {} : { filingNotices }),
  } as PersonalDeductionInput;
}

function app(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'notice',
    assetType: 'inventory',
    businessOrAssetType: '小売業',
    assetClass: '商品',
    newMethod: '先入先出法',
    ...overrides,
  };
}

const methodsLabel = m.income_filing_notices_methods_title();
const closureLabel = m.income_filing_notices_closure_date();
const withdrawalLabel = m.income_filing_notices_withdrawal_year();
const sectionLabel = m.income_filing_notices_title();

function business(overrides: Record<string, unknown> = {}, apps: unknown[] = [app()]) {
  return { business: { methodApplications: apps, ...overrides } };
}

describe('届出事項の保存値の検査', () => {
  test('届出事項が無い記録と、正しい内容の記録は問題なし', () => {
    expect(validatePersonalDeductions(deductions(undefined))).toEqual([]);
    expect(
      validatePersonalDeductions(
        deductions({
          blueReturnWithdrawalYear: 2027,
          ...business({ closureDate: '2026-06-30' }, [
            app({ currentMethod: '定額法', currentAdoptedYear: 2020, memo: '変更' }),
          ]),
          realEstate: { methodApplications: [] },
        }),
      ),
    ).toEqual([]);
  });

  const LIMITS: [string, string, number][] = [
    ['事業の種類', 'businessOrAssetType', 20],
    ['資産の区分', 'assetClass', 40],
    ['新たな方法', 'newMethod', 20],
    ['現在の方法', 'currentMethod', 20],
    ['摘要', 'memo', 40],
  ];

  test.each(LIMITS)('%s の上限ちょうどは通り、1 文字超えると見つける', (_title, key, max) => {
    expect(
      validatePersonalDeductions(deductions(business({}, [app({ [key]: 'あ'.repeat(max) })]))),
    ).toEqual([]);
    expect(
      validatePersonalDeductions(deductions(business({}, [app({ [key]: 'あ'.repeat(max + 1) })]))),
    ).toEqual([methodsLabel]);
  });

  test('上限は文字数で数える（サロゲートペアの文字を 1 文字と数える）', () => {
    expect(
      validatePersonalDeductions(deductions(business({}, [app({ memo: '𠮷'.repeat(40) })]))),
    ).toEqual([]);
    expect(
      validatePersonalDeductions(deductions(business({}, [app({ memo: '𠮷'.repeat(41) })]))),
    ).toEqual([methodsLabel]);
  });

  test.each([
    ['区分が列挙値でない', { kind: 'other' }],
    ['資産種別が列挙値でない', { assetType: 'land' }],
    ['新たな方法が文字列でない', { newMethod: 1 }],
    ['現在の方法が文字列でない', { currentMethod: 1 }],
    ['採用した年が文字列', { currentAdoptedYear: '2020' }],
  ])('%s明細を見つける', (_title, overrides) => {
    expect(validatePersonalDeductions(deductions(business({}, [app(overrides)])))).toEqual([
      methodsLabel,
    ]);
  });

  test('明細が配列でない・オブジェクトでない行を見つける', () => {
    expect(
      validatePersonalDeductions(deductions({ business: { methodApplications: {} } })),
    ).toEqual([methodsLabel]);
    expect(validatePersonalDeductions(deductions(business({}, ['x'])))).toEqual([methodsLabel]);
  });

  test('届出事項や事業用・不動産用がオブジェクトでないとき見つける', () => {
    expect(validatePersonalDeductions(deductions('x'))).toEqual([sectionLabel]);
    expect(validatePersonalDeductions(deductions({ business: 'x' }))).toEqual([sectionLabel]);
    expect(validatePersonalDeductions(deductions({ realEstate: 1 }))).toEqual([sectionLabel]);
  });

  test.each([
    ['日付の形式が違う', '2026/06/30', true],
    ['空文字列', '', true],
    ['存在しない日付', '2026-02-30', true],
    ['2019 年より前', '2018-12-31', true],
    ['2117 年より後', '2118-01-01', true],
    ['文字列でない', 20260630, true],
    ['下限ちょうど', '2019-01-01', false],
    ['上限ちょうど', '2117-12-31', false],
    ['うるう日', '2024-02-29', false],
  ])('廃業日: %s', (_title, closureDate, invalid) => {
    expect(validatePersonalDeductions(deductions(business({ closureDate }, [])))).toEqual(
      invalid ? [closureLabel] : [],
    );
  });

  test.each([
    [2018, true],
    [2118, true],
    [2026.5, true],
    ['2027', true],
    [2019, false],
    [2117, false],
  ])('取りやめ年分 %j', (year, invalid) => {
    expect(validatePersonalDeductions(deductions({ blueReturnWithdrawalYear: year }))).toEqual(
      invalid ? [withdrawalLabel] : [],
    );
  });

  test.each([
    [1925, true],
    [2118, true],
    [2020.5, true],
    [1926, false],
    [2019, false],
    [2117, false],
  ])('採用した年 %j', (year, invalid) => {
    expect(
      validatePersonalDeductions(deductions(business({}, [app({ currentAdoptedYear: year })]))),
    ).toEqual(invalid ? [methodsLabel] : []);
  });

  test('不動産用の問題も見つけ、同じ欄名は 1 つにまとめる', () => {
    expect(
      validatePersonalDeductions(
        deductions({
          business: { closureDate: '2018-12-31', methodApplications: [] },
          realEstate: { closureDate: '2118-01-01', methodApplications: [app({ kind: 'x' })] },
        }),
      ),
    ).toEqual([closureLabel, methodsLabel]);
  });
});
