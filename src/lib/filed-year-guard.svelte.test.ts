import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { db } from '../db/db';
import { markYearFiled } from '../domain/snapshots';
import { filedYearGuard } from './filed-year-guard.svelte';
import { getSetting, setSetting } from './settings';
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
  filedYearGuard.pending = null;
});

afterEach(async () => {
  filedYearGuard.pending = null;
  await db.delete();
});

describe('filedYearGuard.confirm', () => {
  test('申告済み年度が無ければダイアログを出さずに続行', async () => {
    await expect(filedYearGuard.confirm([2026])).resolves.toBe(true);
    expect(filedYearGuard.pending).toBeNull();
  });

  test('申告済み年度があれば保留になり、続行の選択で true', async () => {
    await markYearFiled(2026, { monthlySales, pl }, '2026-12-31');
    const p = filedYearGuard.confirm([2025, 2026]);
    await vi.waitFor(() => expect(filedYearGuard.pending).not.toBeNull());
    expect(filedYearGuard.pending?.years).toEqual([2026]);
    await filedYearGuard.resolve(true);
    await expect(p).resolves.toBe(true);
    expect(filedYearGuard.pending).toBeNull();
  });

  test('取消の選択で false', async () => {
    await markYearFiled(2026, { monthlySales, pl }, '2026-12-31');
    const p = filedYearGuard.confirm([2026]);
    await vi.waitFor(() => expect(filedYearGuard.pending).not.toBeNull());
    await filedYearGuard.resolve(false);
    await expect(p).resolves.toBe(false);
  });

  test('detail と suppressible が保留状態に渡る', async () => {
    await markYearFiled(2026, { monthlySales, pl }, '2026-12-31');
    const p = filedYearGuard.confirm([2026], { detail: '除却額 100,000 円', suppressible: true });
    await vi.waitFor(() => expect(filedYearGuard.pending).not.toBeNull());
    expect(filedYearGuard.pending?.detail).toBe('除却額 100,000 円');
    expect(filedYearGuard.pending?.suppressible).toBe(true);
    await filedYearGuard.resolve(false);
    await p;
  });

  test('「今後表示しない」で続行すると設定に記録され、以後は抑制可の呼出だけ素通りする', async () => {
    await markYearFiled(2026, { monthlySales, pl }, '2026-12-31');
    const p = filedYearGuard.confirm([2026], { suppressible: true });
    await vi.waitFor(() => expect(filedYearGuard.pending).not.toBeNull());
    await filedYearGuard.resolve(true, true);
    await expect(p).resolves.toBe(true);
    expect(await getSetting('skipFiledYearWarning')).toBe(true);

    await expect(filedYearGuard.confirm([2026], { suppressible: true })).resolves.toBe(true);
    expect(filedYearGuard.pending).toBeNull();

    // 抑制対象外の経路（既定）は設定に関係なく確認を出す
    const p2 = filedYearGuard.confirm([2026]);
    await vi.waitFor(() => expect(filedYearGuard.pending).not.toBeNull());
    await filedYearGuard.resolve(false);
    await expect(p2).resolves.toBe(false);
  });

  test('取消では「今後表示しない」を記録しない', async () => {
    await markYearFiled(2026, { monthlySales, pl }, '2026-12-31');
    const p = filedYearGuard.confirm([2026], { suppressible: true });
    await vi.waitFor(() => expect(filedYearGuard.pending).not.toBeNull());
    await filedYearGuard.resolve(false, true);
    await expect(p).resolves.toBe(false);
    expect(await getSetting('skipFiledYearWarning')).toBeUndefined();
  });

  test('保留が無いときの resolve は何もしない', async () => {
    await setSetting('skipFiledYearWarning', false);
    await expect(filedYearGuard.resolve(true, true)).resolves.toBeUndefined();
    expect(await getSetting('skipFiledYearWarning')).toBe(false);
  });
});
