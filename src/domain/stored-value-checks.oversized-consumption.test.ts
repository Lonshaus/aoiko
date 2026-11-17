import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { setSetting } from '../lib/settings';
import { findOversizedConsumptionTaxSettings } from './stored-value-checks';

const BIG = '100000000000000';

const LABELS = {
  base: '基準期間（前々年）の課税売上高（円）',
  specified: '特定期間（前年1月〜6月）の課税売上高（円）',
  return78: '売上対価の返還等に係る消費税額（税率7.8%分）',
  return624: '売上対価の返還等に係る消費税額（税率6.24%分）',
  transfer: '特定少額資産の譲渡（3 割特例の基礎から控除）',
};

const STORE: [string, (v: unknown) => Promise<void>][] = [
  [LABELS.base, (v) => setSetting('basePeriodTaxableSales', v as string)],
  [LABELS.specified, (v) => setSetting('specifiedPeriodTaxableSales', v as string)],
  [
    LABELS.return78,
    (v) => setSetting('wariBaseAdjustments', { 2026: { salesReturnTax78: v as string } }),
  ],
  [
    LABELS.return624,
    (v) => setSetting('wariBaseAdjustments', { 2026: { salesReturnTax624: v as string } }),
  ],
  [
    LABELS.transfer,
    (v) =>
      setSetting('wariBaseAdjustments', {
        2026: {
          specifiedSmallAssetTransfers: [{ date: '2026-03-01', rate: 0.1, netTax: v as string }],
        },
      }),
  ],
];

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('findOversizedConsumptionTaxSettings', () => {
  test.each(STORE)('「%s」が 100 兆円ちょうどなら、その設定名だけを返す', async (label, store) => {
    await store(BIG);
    expect(await findOversizedConsumptionTaxSettings(2026)).toEqual([label]);
  });

  test('5 つの設定がすべて 100 兆円以上なら、設定画面の並びで 5 つとも返す', async () => {
    await setSetting('basePeriodTaxableSales', BIG);
    await setSetting('specifiedPeriodTaxableSales', '200000000000000');
    await setSetting('wariBaseAdjustments', {
      2026: {
        salesReturnTax78: BIG,
        salesReturnTax624: BIG,
        specifiedSmallAssetTransfers: [{ date: '2026-03-01', rate: 0.1, netTax: BIG }],
      },
    });
    expect(await findOversizedConsumptionTaxSettings(2026)).toEqual([
      LABELS.base,
      LABELS.specified,
      LABELS.return78,
      LABELS.return624,
      LABELS.transfer,
    ]);
  });

  test.each(STORE)('「%s」が 99,999,999,999,999 円なら返さない', async (_label, store) => {
    await store('99999999999999');
    expect(await findOversizedConsumptionTaxSettings(2026)).toEqual([]);
  });

  test('未設定なら返さない', async () => {
    expect(await findOversizedConsumptionTaxSettings(2026)).toEqual([]);
  });

  test.each(STORE)('「%s」が読めない値（abc・指数・数値）なら返さない', async (_label, store) => {
    for (const bad of ['abc', '1e14', 100000000000000]) {
      await store(bad);
      expect(await findOversizedConsumptionTaxSettings(2026)).toEqual([]);
    }
  });

  test.each(STORE)('「%s」が負の値なら返さない', async (_label, store) => {
    await store('-100000000000000');
    expect(await findOversizedConsumptionTaxSettings(2026)).toEqual([]);
  });

  test('別の年分の 2 割特例の金額は見ない', async () => {
    await setSetting('wariBaseAdjustments', { 2025: { salesReturnTax78: BIG } });
    expect(await findOversizedConsumptionTaxSettings(2026)).toEqual([]);
  });
});
