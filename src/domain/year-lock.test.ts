import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { markYearFiled } from './snapshots';
import { lockedYearsAmong } from './year-lock';
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

describe('lockedYearsAmong', () => {
  test('空の入力なら空配列', async () => {
    expect(await lockedYearsAmong([])).toEqual([]);
  });

  test('申告済み年度のみを昇順で返す', async () => {
    await markYearFiled(2024, { monthlySales, pl }, '2024-12-31');
    await markYearFiled(2026, { monthlySales, pl }, '2026-12-31');
    const r = await lockedYearsAmong([2026, 2025, 2024]);
    expect(r).toEqual([2024, 2026]);
  });

  test('重複を排除する', async () => {
    await markYearFiled(2026, { monthlySales, pl }, '2026-12-31');
    const r = await lockedYearsAmong([2026, 2026, 2025, 2025]);
    expect(r).toEqual([2026]);
  });

  test('未申告年度は含まれない', async () => {
    await markYearFiled(2026, { monthlySales, pl }, '2026-12-31');
    const r = await lockedYearsAmong([2025, 2027]);
    expect(r).toEqual([]);
  });
});
