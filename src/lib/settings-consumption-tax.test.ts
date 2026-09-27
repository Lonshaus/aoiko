import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { D } from './decimal';
import { compareAll } from '../domain/consumption-tax';
import { interimFilingObligation } from '../domain/interim-filing';
import {
  getSetting,
  loadInterimPriorPeriodMonths,
  loadInterimVoluntaryInputs,
  loadSmallAmountSpecialInputs,
  loadWariBaseAdjustments,
  loadWariEligibilityInputs,
  setSetting,
} from './settings';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('消費税の特例判定に使う設定の読み込み', () => {
  test('どの設定も無ければ空の入力になり、判定は従来どおりになる', async () => {
    expect(await loadWariEligibilityInputs()).toEqual({});
    expect(await loadSmallAmountSpecialInputs()).toEqual({});
    expect(await loadInterimVoluntaryInputs()).toEqual({
      interimVoluntaryFiled: false,
      interimVoluntaryLapsed: false,
    });
  });

  test('保存した値を判定用の形に変換する', async () => {
    await setSetting('invoiceRegistrationStartDate', '2023-10-01');
    await setSetting('taxableElectionPeriod', { fromYear: 2021, toYear: 2024 });
    await setSetting('inheritanceSpecialDate', '2023-05-01');
    await setSetting('adjustedFixedAssetDate', '2024-03-01');
    await setSetting('shortenedTaxPeriod', { from: '2025-01-01' });
    await setSetting('foreignWithoutDomesticPe', true);
    await setSetting('basePeriodTaxableSales', '12000000');
    await setSetting('specifiedPeriodTaxableSales', '3000000');
    await setSetting('interimVoluntaryFiled', true);
    const eligibility = await loadWariEligibilityInputs();
    expect(eligibility.registrationStartDate).toBe('2023-10-01');
    expect(eligibility.taxableElection).toEqual({ fromYear: 2021, toYear: 2024 });
    expect(eligibility.inheritanceDate).toBe('2023-05-01');
    expect(eligibility.adjustedFixedAssetDate).toBe('2024-03-01');
    expect(eligibility.shortenedPeriod).toEqual({ from: '2025-01-01' });
    expect(eligibility.foreignWithoutDomesticPe).toBe(true);
    expect(eligibility.basePeriodSales?.toString()).toBe('12000000');
    const small = await loadSmallAmountSpecialInputs();
    expect(small.basePeriodSales?.toString()).toBe('12000000');
    expect(small.specifiedPeriodSales?.toString()).toBe('3000000');
    expect((await loadInterimVoluntaryInputs()).interimVoluntaryFiled).toBe(true);
  });

  test('空文字・壊れた金額は未設定と同じに扱い、除外事由にしない', async () => {
    await setSetting('invoiceRegistrationStartDate', '');
    await setSetting('basePeriodTaxableSales', 'abc');
    await setSetting('specifiedPeriodTaxableSales', '-1');
    await setSetting('foreignWithoutDomesticPe', false);
    await setSetting('shortenedTaxPeriod', { from: '' });
    expect(await loadWariEligibilityInputs()).toEqual({});
    expect(await loadSmallAmountSpecialInputs()).toEqual({});
  });
});
