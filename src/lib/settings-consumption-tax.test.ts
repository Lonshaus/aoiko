import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { D } from './decimal';
import {
  compareAll,
  isThreeWariEligibleYear,
  isTwoWariEligibleYear,
} from '../domain/consumption-tax';
import { interimFilingObligation } from '../domain/interim-filing';
import {
  getSetting,
  loadBusinessDates,
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

describe('特定少額資産の譲渡行の金額の読み込み', () => {
  test('カンマ付き・全角は値として読み、空・負・数値でない文字列は0として読み、例外を投げない', async () => {
    await setSetting('wariBaseAdjustments', {
      2026: {
        specifiedSmallAssetTransfers: [
          { date: '2026-01-01', rate: 0.1, netTax: '5,000' },
          { date: '2026-01-02', rate: 0.1, netTax: 'abc' },
          { date: '2026-01-03', rate: 0.08, netTax: '' },
          { date: '2026-01-04', rate: 0.1, netTax: '５０００' },
          { date: '2026-01-05', rate: 0.1, netTax: '5000円' },
          { date: '2026-01-06', rate: 0.1, netTax: '５，０００' },
          { date: '2026-01-07', rate: 0.1, netTax: '－5000' },
        ],
      },
    });
    const adj = await loadWariBaseAdjustments(2026);
    expect(adj.specifiedSmallAssetTransfers?.map((t) => t.netTax.toString())).toEqual([
      '5000',
      '0',
      '0',
      '5000',
      '0',
      '5000',
      '0',
    ]);
  });

  test('以前のバージョンで全角のまま保存された返還等の税額も値として読む', async () => {
    await setSetting('wariBaseAdjustments', {
      2026: { salesReturnTax78: '５０００', salesReturnTax624: '１，２００' },
    });
    const adj = await loadWariBaseAdjustments(2026);
    expect(adj.salesReturnTax78?.toString()).toBe('5000');
    expect(adj.salesReturnTax624?.toString()).toBe('1200');
  });
});

describe('復元したバックアップの金額が文字列でない場合', () => {
  test('数値・null の金額でも読み込みは例外を投げず、未設定として扱う', async () => {
    for (const v of [5000, null]) {
      await setSetting('basePeriodTaxableSales', v as never);
      await setSetting('specifiedPeriodTaxableSales', v as never);
      await setSetting('wariBaseAdjustments', {
        2026: {
          salesReturnTax78: v as never,
          specifiedSmallAssetTransfers: [{ date: '2026-03-01', rate: 0.1, netTax: v as never }],
        },
      });
      expect(await loadSmallAmountSpecialInputs()).toEqual({});
      expect(await loadWariEligibilityInputs()).toEqual({});
      const adj = await loadWariBaseAdjustments(2026);
      expect(adj.salesReturnTax78).toBeUndefined();
      expect(adj.specifiedSmallAssetTransfers?.[0]?.netTax.toString()).toBe('0');
    }
  });
});

describe('復元したバックアップの設定値が想定外の形の場合', () => {
  test('期間・月数・調整額の設定がオブジェクトでなくても例外を投げず、未設定として扱う', async () => {
    for (const v of [null, 5000, 'abc', true, [], ['2025-01-01']]) {
      await setSetting('taxableElectionPeriod', v as never);
      await setSetting('shortenedTaxPeriod', v as never);
      await setSetting('interimPriorPeriodMonths', v as never);
      await setSetting('wariBaseAdjustments', v as never);
      expect(await loadWariEligibilityInputs()).toEqual({});
      expect(await loadInterimPriorPeriodMonths(2026)).toBe(12);
      expect(await loadWariBaseAdjustments(2026)).toEqual({});
    }
  });

  test('課税選択・短縮の期間の項目が想定外の型なら、期間ごと未設定として扱う', async () => {
    const cases: [unknown, unknown][] = [
      [{ fromYear: '2021' }, { from: 20250101 }],
      [
        { fromYear: 2021, toYear: '2024' },
        { from: '2025-01-01', to: 20251231 },
      ],
      [{ fromYear: 2021.5 }, { from: null }],
      [{}, {}],
    ];
    for (const [election, shortened] of cases) {
      await setSetting('taxableElectionPeriod', election as never);
      await setSetting('shortenedTaxPeriod', shortened as never);
      expect(await loadWariEligibilityInputs()).toEqual({});
    }
  });

  test('日付の設定が文字列でなければ未設定として扱い、特例の判定も例外を投げない', async () => {
    await setSetting('invoiceRegistrationStartDate', 20231001 as never);
    await setSetting('inheritanceSpecialDate', { date: '2023-05-01' } as never);
    await setSetting('adjustedFixedAssetDate', 2024 as never);
    await setSetting('businessStartDate', 5 as never);
    await setSetting('businessCloseDate', null as never);
    const eligibility = await loadWariEligibilityInputs();
    expect(eligibility).toEqual({});
    expect(isTwoWariEligibleYear(2026, eligibility)).toBe(true);
    expect(isThreeWariEligibleYear(2027, eligibility)).toBe(true);
    expect(await loadBusinessDates()).toEqual({});
  });

  test('中間申告の届出の設定が真偽値でなければ、届出なしとして扱う', async () => {
    await setSetting('interimVoluntaryFiled', 'yes' as never);
    await setSetting('interimVoluntaryLapsed', 1 as never);
    expect(await loadInterimVoluntaryInputs()).toEqual({
      interimVoluntaryFiled: false,
      interimVoluntaryLapsed: false,
    });
  });

  test('直前の課税期間の月数が1〜12の整数でなければ12として扱う', async () => {
    for (const v of ['6', 0, 13, 6.5, null, {}]) {
      await setSetting('interimPriorPeriodMonths', { 2026: v as never });
      expect(await loadInterimPriorPeriodMonths(2026)).toBe(12);
    }
    await setSetting('interimPriorPeriodMonths', { 2026: 6 });
    expect(await loadInterimPriorPeriodMonths(2026)).toBe(6);
  });

  test('年分の調整額がオブジェクトでなければ、その年分は未設定として扱う', async () => {
    for (const v of [null, 5, 'abc', [], [{ salesReturnTax78: '100' }]]) {
      await setSetting('wariBaseAdjustments', { 2026: v as never });
      expect(await loadWariBaseAdjustments(2026)).toEqual({});
    }
  });

  test('譲渡行の一覧が配列でなければ行なしとして扱い、返還等の税額は読む', async () => {
    for (const v of [null, 5, 'abc', {}, { 0: { date: '2026-03-01', rate: 0.1, netTax: '100' } }]) {
      await setSetting('wariBaseAdjustments', {
        2026: { salesReturnTax78: '300', specifiedSmallAssetTransfers: v as never },
      });
      const adj = await loadWariBaseAdjustments(2026);
      expect(adj.salesReturnTax78?.toString()).toBe('300');
      expect(adj.specifiedSmallAssetTransfers).toBeUndefined();
    }
  });

  test('譲渡行のうちオブジェクトでない行・日付や税率が想定外の行は除き、残りを読む', async () => {
    await setSetting('wariBaseAdjustments', {
      2026: {
        specifiedSmallAssetTransfers: [
          null,
          5,
          'x',
          [],
          { date: 20260301, rate: 0.1, netTax: '100' },
          { date: '2026-03-01', rate: '0.1', netTax: '100' },
          { date: '2026-03-01', rate: 0.05, netTax: '100' },
          { date: '2026-03-02', rate: 0.08, netTax: '200' },
        ] as never,
      },
    });
    const adj = await loadWariBaseAdjustments(2026);
    expect(
      adj.specifiedSmallAssetTransfers?.map((t) => [t.date, t.rate, t.netTax.toString()]),
    ).toEqual([['2026-03-02', 0.08, '200']]);
  });
});
