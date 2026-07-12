import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { getConsumptionTaxSnapshot, isYearLocked, markYearFiled, unlockYear } from './snapshots';
import type { ReportSnapshotData } from '../db/types';

const monthlySales: ReportSnapshotData & { type: 'monthly-sales' } = {
  type: 'monthly-sales',
  data: { months: [] },
};
const pl: ReportSnapshotData & { type: 'pl' } = {
  type: 'pl',
  data: { rows: [], totalRevenue: '0', totalExpense: '0', netIncome: '0' },
};

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('markYearFiled', () => {
  test('writes monthly-sales + pl snapshots', async () => {
    await markYearFiled(2026, { monthlySales, pl }, '2026-12-31');
    const all = await db.reportSnapshots.toArray();
    expect(all).toHaveLength(2);
    expect(all.every((s) => s.status === 'filed')).toBe(true);
    expect(all.every((s) => s.year === 2026)).toBe(true);
  });

  test('includes BS when provided', async () => {
    const bs: ReportSnapshotData & { type: 'bs' } = {
      type: 'bs',
      data: { assets: [], liabilities: [], equity: [] },
    };
    await markYearFiled(2026, { monthlySales, pl, bs }, '2026-12-31');
    const all = await db.reportSnapshots.toArray();
    expect(all).toHaveLength(3);
  });
});

describe('consumption-tax snapshot（中間申告義務判定の基準）', () => {
  test('markYearFiled に consumptionTax を渡すと記録され、getConsumptionTaxSnapshot で取得できる', async () => {
    const consumptionTax: ReportSnapshotData & { type: 'consumption-tax' } = {
      type: 'consumption-tax',
      data: { method: 'general', netTaxNational: '1234500' },
    };
    await markYearFiled(2026, { monthlySales, pl, consumptionTax }, '2026-12-31');
    const all = await db.reportSnapshots.toArray();
    expect(all).toHaveLength(3);
    const snap = await getConsumptionTaxSnapshot(2026);
    expect(snap).toEqual({ method: 'general', netTaxNational: '1234500' });
  });

  test('未ロック年度は undefined を返す', async () => {
    expect(await getConsumptionTaxSnapshot(2026)).toBeUndefined();
  });
});

describe('isYearLocked', () => {
  test('returns false when no snapshot filed', async () => {
    expect(await isYearLocked(2026)).toBe(false);
  });

  test('returns true after markYearFiled', async () => {
    await markYearFiled(2026, { monthlySales, pl }, '2026-12-31');
    expect(await isYearLocked(2026)).toBe(true);
    expect(await isYearLocked(2025)).toBe(false);
  });
});

describe('unlockYear', () => {
  test('ロックを解除し、filed を superseded に変更（削除しない）', async () => {
    await markYearFiled(2026, { monthlySales, pl }, '2026-12-31');
    const r = await unlockYear(2026);
    expect(r.removed).toBe(2);
    expect(await isYearLocked(2026)).toBe(false);
    // スナップショット自体は残る（修正申告差分の基準として保持）
    const remaining = await db.reportSnapshots.where('year').equals(2026).toArray();
    expect(remaining).toHaveLength(2);
    expect(remaining.every((s) => s.status === 'superseded')).toBe(true);
  });
});
