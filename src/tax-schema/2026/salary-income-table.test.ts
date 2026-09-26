import { describe, expect, test } from 'vitest';
import { D } from '../../lib/decimal';
import { isWithinSalaryIncomeTableRange, salaryIncomeFromTable } from './salary-income-table';

describe('salaryIncomeFromTable（旧表：令和8年12月1日前支払）', () => {
  test('651,000円未満は0円', () => {
    expect(salaryIncomeFromTable('old', D(650_999)).toString()).toBe('0');
  });

  test('651,000円は下限を含み給与等の金額−65万円', () => {
    expect(salaryIncomeFromTable('old', D(651_000)).toString()).toBe('1000');
    expect(salaryIncomeFromTable('old', D(1_899_999)).toString()).toBe('1249999');
  });

  test('1,900,000円以上は4,000円区分の階差表（区分下限で28条3項1・2号を適用）', () => {
    expect(salaryIncomeFromTable('old', D(1_900_000)).toString()).toBe('1250000');
    expect(salaryIncomeFromTable('old', D(1_903_999)).toString()).toBe('1250000');
    expect(salaryIncomeFromTable('old', D(1_904_000)).toString()).toBe('1252800');
    expect(salaryIncomeFromTable('old', D(2_036_000)).toString()).toBe('1345200');
  });

  test('3,600,000円超は28条3項3号（20%）の区分に切り替わる', () => {
    expect(salaryIncomeFromTable('old', D(3_600_000)).toString()).toBe('2440000');
    expect(salaryIncomeFromTable('old', D(3_604_000)).toString()).toBe('2443200');
  });

  test('660万円未満の上限区分（6,596,000〜6,600,000未満）', () => {
    expect(salaryIncomeFromTable('old', D(6_596_000)).toString()).toBe('4836800');
    expect(salaryIncomeFromTable('old', D(6_599_999)).toString()).toBe('4836800');
  });
});

describe('salaryIncomeFromTable（新表：令和8年12月1日以後支払・令和9年分以後）', () => {
  test('691,000円未満は0円', () => {
    expect(salaryIncomeFromTable('new', D(690_999)).toString()).toBe('0');
  });

  test('691,000円は下限を含み給与等の金額−69万円', () => {
    expect(salaryIncomeFromTable('new', D(691_000)).toString()).toBe('1000');
    expect(salaryIncomeFromTable('new', D(2_025_999)).toString()).toBe('1335999');
  });

  test('2,026,000〜2,028,000未満は例外的な2,000円区分（1,336,000円固定）', () => {
    expect(salaryIncomeFromTable('new', D(2_026_000)).toString()).toBe('1336000');
    expect(salaryIncomeFromTable('new', D(2_027_999)).toString()).toBe('1336000');
  });

  test('2,028,000円以上は4,000円区分に復帰し、2,036,000円から旧表と一致する', () => {
    expect(salaryIncomeFromTable('new', D(2_028_000)).toString()).toBe('1338000');
    expect(salaryIncomeFromTable('new', D(2_032_000)).toString()).toBe('1342000');
    expect(salaryIncomeFromTable('new', D(2_036_000)).toString()).toBe('1345200');
    expect(salaryIncomeFromTable('old', D(2_036_000)).toString()).toBe(
      salaryIncomeFromTable('new', D(2_036_000)).toString(),
    );
  });

  test('3,000,001円は本則の連続値ではなく別表第五の区分値', () => {
    // 本則：3,000,001 − (80,000 + 3,000,001×30% ≒ 980,000.3) ≒ 2,020,000.7（表とは不一致）
    expect(salaryIncomeFromTable('new', D(3_000_001)).toString()).toBe('2020000');
  });

  test('3,600,000円超は20%の区分に切り替わる', () => {
    expect(salaryIncomeFromTable('new', D(3_600_000)).toString()).toBe('2440000');
  });

  test('660万円未満の上限区分（6,596,000〜6,600,000未満）は旧表と同じ', () => {
    expect(salaryIncomeFromTable('new', D(6_596_000)).toString()).toBe('4836800');
  });
});

describe('isWithinSalaryIncomeTableRange', () => {
  test('660万円未満は対象、660万円以上は対象外', () => {
    expect(isWithinSalaryIncomeTableRange(D(6_599_999))).toBe(true);
    expect(isWithinSalaryIncomeTableRange(D(6_600_000))).toBe(false);
  });
});
