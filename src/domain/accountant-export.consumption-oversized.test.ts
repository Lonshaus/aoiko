import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { setSetting } from '../lib/settings';
import { exportGenericCsv, exportYayoiCsv } from './accountant-export';

const BIG = '100000000000000';

const TOO_LARGE = (items: string) =>
  `保存されている次の金額が 100 兆円以上のため、出力できません。設定や入力画面で直してください：${items}`;
const UNREADABLE = (items: string) =>
  `保存されている次の値を読めないため、出力できません。設定や入力画面で直してください：${items}`;

const SETTINGS: [string, (v: string) => Promise<void>][] = [
  ['基準期間（前々年）の課税売上高（円）', (v) => setSetting('basePeriodTaxableSales', v)],
  [
    '特定期間（前年1月〜6月）の課税売上高（円）',
    (v) => setSetting('specifiedPeriodTaxableSales', v),
  ],
  [
    '売上対価の返還等に係る消費税額（税率7.8%分）',
    (v) => setSetting('wariBaseAdjustments', { 2026: { salesReturnTax78: v } }),
  ],
  [
    '売上対価の返還等に係る消費税額（税率6.24%分）',
    (v) => setSetting('wariBaseAdjustments', { 2026: { salesReturnTax624: v } }),
  ],
  [
    '特定少額資産の譲渡（3 割特例の基礎から控除）',
    (v) =>
      setSetting('wariBaseAdjustments', {
        2026: { specifiedSmallAssetTransfers: [{ date: '2026-03-01', rate: 0.1, netTax: v }] },
      }),
  ],
];

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.accounts.bulkAdd([
    { code: '1130', year: 2026, name: '普通預金', category: 'asset', displayOrder: 130 },
    { code: '5150', year: 2026, name: '通信費', category: 'expense', displayOrder: 150 },
  ]);
});

afterEach(async () => {
  await db.delete();
});

describe('弥生 CSV：消費税の設定が 100 兆円以上のとき', () => {
  test.each(SETTINGS)('「%s」が 100 兆円以上なら新しい文言で止まる', async (label, store) => {
    await store(BIG);
    await expect(exportYayoiCsv(2026)).rejects.toMatchObject({ message: TOO_LARGE(label) });
  });

  test.each(SETTINGS)('「%s」が 99,999,999,999,999 円なら出力する', async (_label, store) => {
    await store('99999999999999');
    await expect(exportYayoiCsv(2026)).resolves.toBeInstanceOf(Uint8Array);
  });

  test.each(SETTINGS)('「%s」が負の値なら従来の文言で止まる', async (label, store) => {
    await store('-100000000000000');
    await expect(exportYayoiCsv(2026)).rejects.toMatchObject({ message: UNREADABLE(label) });
  });

  test.each(SETTINGS)('「%s」が読めない値なら従来の文言で止まる', async (label, store) => {
    await store('abc');
    await expect(exportYayoiCsv(2026)).rejects.toMatchObject({ message: UNREADABLE(label) });
  });

  test.each(SETTINGS.slice(1))(
    '読めない基準期間と 100 兆円以上の「%s」が同時にあれば、読めない値の文言だけで止まる',
    async (_label, store) => {
      await SETTINGS[0]![1]('abc');
      await store(BIG);
      await expect(exportYayoiCsv(2026)).rejects.toMatchObject({
        message: UNREADABLE(SETTINGS[0]![0]),
      });
    },
  );

  test.each(SETTINGS)('「%s」が 100 兆円以上でも、汎用 CSV は止まらない', async (_label, store) => {
    await store(BIG);
    await expect(exportGenericCsv(2026)).resolves.toBeInstanceOf(Uint8Array);
  });
});
