import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { markYearFiled } from './snapshots';
import { assertYearsWritable, FiledYearError, lockedYearsAmong } from './year-lock';
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

describe('assertYearsWritable', () => {
  test('未申告年度なら通す', async () => {
    await expect(assertYearsWritable([2025])).resolves.toBeUndefined();
  });

  test('申告済み年度が 1 つでも混ざれば止める', async () => {
    await markYearFiled(2026, { monthlySales, pl }, '2026-12-31');
    await expect(assertYearsWritable([2025, 2026, 2027])).rejects.toThrow(FiledYearError);
  });

  test('止めた年度を持たせる（どの年度で止まったか出せるように）', async () => {
    await markYearFiled(2024, { monthlySales, pl }, '2024-12-31');
    await markYearFiled(2026, { monthlySales, pl }, '2026-12-31');
    const err = await assertYearsWritable([2024, 2025, 2026]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FiledYearError);
    expect((err as FiledYearError).years).toEqual([2024, 2026]);
  });

  test('確認を通った呼出だけ allowFiledYear で開ける', async () => {
    await markYearFiled(2026, { monthlySales, pl }, '2026-12-31');
    await expect(assertYearsWritable([2026], { allowFiledYear: true })).resolves.toBeUndefined();
  });

  // 省略・undefined・false のどれも「開けない」側に倒す。allowFiledYear は
  // 明示的に true を渡したときだけ効く門であって、既定で開いてはいけない。
  test('allowFiledYear は明示的な true 以外では開かない', async () => {
    await markYearFiled(2026, { monthlySales, pl }, '2026-12-31');
    await expect(assertYearsWritable([2026], {})).rejects.toThrow(FiledYearError);
    await expect(assertYearsWritable([2026], { allowFiledYear: false })).rejects.toThrow(
      FiledYearError,
    );
    await expect(assertYearsWritable([2026], undefined)).rejects.toThrow(FiledYearError);
  });

  test('年度が空なら何も止めない', async () => {
    await markYearFiled(2026, { monthlySales, pl }, '2026-12-31');
    await expect(assertYearsWritable([])).resolves.toBeUndefined();
  });
});
