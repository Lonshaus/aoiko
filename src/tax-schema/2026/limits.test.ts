import { describe, expect, test } from 'vitest';
import {
  LUMP_SUM_MAX,
  LUMP_SUM_MIN,
  SMALL_ASSET_ANNUAL_CAP,
  SMALL_ASSET_EXPIRY,
  businessMonthsInYear,
  calendarMonthsCeil,
  isImmediateExpenseRequired,
  isLumpSumEligible,
  isSmallAssetEligible,
  smallAssetAnnualCap,
  smallAssetEmployeeLimit,
  smallAssetThreshold,
} from './limits';

describe('smallAssetThreshold', () => {
  test('2026-03-31 以前取得は 300_000', () => {
    expect(smallAssetThreshold('2025-12-31')).toBe(300_000);
    expect(smallAssetThreshold('2026-01-01')).toBe(300_000);
    expect(smallAssetThreshold('2026-03-31')).toBe(300_000);
  });

  test('2026-04-01 以降取得は 400_000', () => {
    expect(smallAssetThreshold('2026-04-01')).toBe(400_000);
    expect(smallAssetThreshold('2026-04-02')).toBe(400_000);
    expect(smallAssetThreshold('2028-12-31')).toBe(400_000);
  });
});

describe('isSmallAssetEligible', () => {
  test('閾値未満なら true（境界：30 万）', () => {
    expect(isSmallAssetEligible('2026-03-31', '299999')).toBe(true);
    expect(isSmallAssetEligible('2026-03-31', '300000')).toBe(false);
  });

  test('閾値未満なら true（境界：40 万）', () => {
    expect(isSmallAssetEligible('2026-04-01', '399999')).toBe(true);
    expect(isSmallAssetEligible('2026-04-01', '400000')).toBe(false);
  });

  test('適用期限後は常に false', () => {
    expect(SMALL_ASSET_EXPIRY).toBe('2029-03-31');
    expect(isSmallAssetEligible('2029-04-01', '100000')).toBe(false);
    expect(isSmallAssetEligible('2030-01-01', '50000')).toBe(false);
  });

  test('無効な価額（負・NaN）は false', () => {
    expect(isSmallAssetEligible('2026-04-01', '-1')).toBe(false);
    expect(isSmallAssetEligible('2026-04-01', 'abc')).toBe(false);
  });
});

describe('SMALL_ASSET_ANNUAL_CAP', () => {
  test('300 万円据置', () => {
    expect(SMALL_ASSET_ANNUAL_CAP).toBe(3_000_000);
  });
});

describe('isLumpSumEligible', () => {
  test('10万円以上20万円未満なら true', () => {
    expect(LUMP_SUM_MIN).toBe(100_000);
    expect(LUMP_SUM_MAX).toBe(200_000);
    expect(isLumpSumEligible('100000')).toBe(true);
    expect(isLumpSumEligible('199999')).toBe(true);
  });

  test('範囲外は false', () => {
    expect(isLumpSumEligible('99999')).toBe(false);
    expect(isLumpSumEligible('200000')).toBe(false);
  });

  test('無効な価額は false', () => {
    expect(isLumpSumEligible('abc')).toBe(false);
  });
});

describe('isSmallAssetEligible（措法28の2第1項括弧・措令18条の5）', () => {
  test('F5：取得価額 10 万円未満は対象外、10 万円ちょうどは対象', () => {
    expect(isSmallAssetEligible('2026-04-01', '50000')).toBe(false);
    expect(isSmallAssetEligible('2026-04-01', '99999')).toBe(false);
    expect(isSmallAssetEligible('2026-04-01', '100000')).toBe(true);
  });

  test('F8：従業員数の上限は取得日で 500 人／400 人に分かれる', () => {
    expect(smallAssetEmployeeLimit('2026-03-31')).toBe(500);
    expect(smallAssetEmployeeLimit('2026-04-01')).toBe(400);
    expect(isSmallAssetEligible('2026-03-31', '200000', { employeeCount: 450 })).toBe(true);
    expect(isSmallAssetEligible('2026-04-01', '200000', { employeeCount: 450 })).toBe(false);
    expect(isSmallAssetEligible('2026-04-01', '200000', { employeeCount: 400 })).toBe(true);
    expect(isSmallAssetEligible('2026-03-31', '200000', { employeeCount: 501 })).toBe(false);
  });

  test('R5：従業員数が未指定なら人数要件で落とさない', () => {
    expect(isSmallAssetEligible('2026-04-01', '200000')).toBe(true);
    expect(isSmallAssetEligible('2026-04-01', '200000', { employeeCount: undefined })).toBe(true);
  });

  test('F9：貸付け用（主要な業務以外）は対象外', () => {
    expect(isSmallAssetEligible('2026-04-01', '200000', { isLeasedOut: true })).toBe(false);
    expect(isSmallAssetEligible('2026-04-01', '200000', { isLeasedOut: false })).toBe(true);
  });
});

describe('少額特例の年合計上限の月割（措法28の2第1項後段・2項）', () => {
  test('F10：開業日 2026-07-01 は 6 か月で 1,500,000', () => {
    expect(businessMonthsInYear(2026, '2026-07-01')).toBe(6);
    expect(smallAssetAnnualCap(2026, '2026-07-01').toString()).toBe('1500000');
  });

  test('F10：廃業日 2026-09-30 は 9 か月で 2,250,000', () => {
    expect(businessMonthsInYear(2026, undefined, '2026-09-30')).toBe(9);
    expect(smallAssetAnnualCap(2026, undefined, '2026-09-30').toString()).toBe('2250000');
  });

  test('開業日・廃業日が無い年、別の年の日付は 12 か月で 300 万円', () => {
    expect(smallAssetAnnualCap(2026).toString()).toBe('3000000');
    expect(smallAssetAnnualCap(2027, '2026-07-01', '2028-03-31').toString()).toBe('3000000');
  });

  test('1 月未満の端数は 1 月とする', () => {
    expect(businessMonthsInYear(2026, '2026-07-15')).toBe(6);
    expect(businessMonthsInYear(2026, '2026-03-15', '2026-09-10')).toBe(6);
    expect(businessMonthsInYear(2026, '2026-03-15', '2026-09-15')).toBe(7);
    expect(calendarMonthsCeil('2026-12-31', '2027-01-01')).toBe(1);
    expect(calendarMonthsCeil('2026-01-01', '2026-01-01')).toBe(0);
  });
});

describe('isImmediateExpenseRequired（所令138条1項）', () => {
  test('10 万円未満は一次費用化、貸付け用（主要な業務以外）は除く', () => {
    expect(isImmediateExpenseRequired('50000', {})).toBe(true);
    expect(isImmediateExpenseRequired('99999', {})).toBe(true);
    expect(isImmediateExpenseRequired('100000', {})).toBe(false);
    expect(isImmediateExpenseRequired('50000', { isLeasedOut: true })).toBe(false);
  });

  test('F7：使用可能期間 1 年未満は金額にかかわらず一次費用化（10 万円未満とは選択関係）', () => {
    expect(isImmediateExpenseRequired('150000', { usableLifeUnderOneYear: true })).toBe(true);
    expect(
      isImmediateExpenseRequired('150000', { usableLifeUnderOneYear: true, isLeasedOut: true }),
    ).toBe(true);
  });
});

describe('isLumpSumEligible（所令139条1項括弧）', () => {
  test('F7：使用可能期間 1 年未満（所令138条の適用あり）は一括償却を選べない', () => {
    expect(isLumpSumEligible('150000', { usableLifeUnderOneYear: true })).toBe(false);
  });

  test('貸付け用（主要な業務以外）は対象外', () => {
    expect(isLumpSumEligible('150000', { isLeasedOut: true })).toBe(false);
    expect(isLumpSumEligible('150000', {})).toBe(true);
  });
});

describe('D2-7b：出租排除の適用期間（令和4年政令第136号附則4条・同法律第4号附則31条）', () => {
  test('D2-F13：取得日2022-03-31・isLeasedOut=true は旧法どおり出租排除を適用しない', () => {
    expect(
      isImmediateExpenseRequired('80000', { isLeasedOut: true, acquisitionDate: '2022-03-31' }),
    ).toBe(true);
    expect(isLumpSumEligible('150000', { isLeasedOut: true, acquisitionDate: '2022-03-31' })).toBe(
      true,
    );
    expect(isSmallAssetEligible('2022-03-31', '250000', { isLeasedOut: true })).toBe(true);
  });

  test('D2-F13：取得日2022-04-01・isLeasedOut=true は出租排除を適用する', () => {
    expect(
      isImmediateExpenseRequired('80000', { isLeasedOut: true, acquisitionDate: '2022-04-01' }),
    ).toBe(false);
    expect(isLumpSumEligible('150000', { isLeasedOut: true, acquisitionDate: '2022-04-01' })).toBe(
      false,
    );
    expect(isSmallAssetEligible('2022-04-01', '250000', { isLeasedOut: true })).toBe(false);
  });

  test('D2-F13：acquisitionDate 未指定は照舊（排除を適用、既存データ互換）', () => {
    expect(isImmediateExpenseRequired('50000', { isLeasedOut: true })).toBe(false);
    expect(isLumpSumEligible('150000', { isLeasedOut: true })).toBe(false);
  });
});
