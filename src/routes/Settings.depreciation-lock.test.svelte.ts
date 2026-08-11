import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { markYearFiled } from '../domain/snapshots';
import { filedYearGuard } from '../lib/filed-year-guard.svelte';
import type { ReportSnapshotData } from '../db/types';

const pl: ReportSnapshotData & { type: 'pl' } = {
  type: 'pl',
  data: { rows: [], totalRevenue: '0', totalExpense: '0', netIncome: '0' },
};
const monthlySales: ReportSnapshotData & { type: 'monthly-sales' } = {
  type: 'monthly-sales',
  data: { months: [] },
};

const { generateYearEndDepreciationMock } = vi.hoisted(() => ({
  generateYearEndDepreciationMock: vi.fn().mockResolvedValue({
    created: 0,
    skipped: 0,
    smallAssetCapExceeded: 0,
    smallAssetIneligible: 0,
  }),
}));

vi.mock('../domain/depreciation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/depreciation')>();
  return { ...actual, generateYearEndDepreciation: generateYearEndDepreciationMock };
});

const { default: Settings } = await import('./Settings.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const CURRENT_YEAR = new Date().getFullYear();

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.fixedAssets.add({
    id: 'a1',
    name: 'テスト資産',
    acquisitionDate: `${CURRENT_YEAR}-01-10`,
    acquisitionCost: '300000',
    usefulLifeYears: 4,
    depreciationMethod: 'straight-line',
    accountCode: '1310',
  });
  generateYearEndDepreciationMock.mockClear();
  filedYearGuard.pending = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Settings, { target: container, props: {} });
});

afterEach(async () => {
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  if (container !== undefined) {
    container.remove();
    container = undefined;
  }
  filedYearGuard.pending = null;
  await db.delete();
});

describe('runDepreciation: 申告済み年度のロック', () => {
  test('申告済み年度なら確認せず実行しない（ダイアログで保留する）', async () => {
    await markYearFiled(CURRENT_YEAR, { monthlySales, pl }, `${CURRENT_YEAR}-12-31`);
    await waitFor(() => document.querySelectorAll('button').length > 0);
    const buttons = Array.from(container!.querySelectorAll('button'));
    const btn = buttons.find((b) => /償却/.test(b.textContent ?? '') && !b.disabled);
    expect(btn).toBeDefined();
    btn!.click();
    await waitFor(() => filedYearGuard.pending !== null);
    expect(filedYearGuard.pending?.years).toEqual([CURRENT_YEAR]);
    expect(generateYearEndDepreciationMock).not.toHaveBeenCalled();
    await filedYearGuard.resolve(true);
    await waitFor(() => generateYearEndDepreciationMock.mock.calls.length > 0);
    expect(generateYearEndDepreciationMock).toHaveBeenCalledWith(CURRENT_YEAR, {
      allowFiledYear: true,
    });
  });

  test('確認で取消を選ぶと生成されない', async () => {
    await markYearFiled(CURRENT_YEAR, { monthlySales, pl }, `${CURRENT_YEAR}-12-31`);
    await waitFor(() => document.querySelectorAll('button').length > 0);
    const buttons = Array.from(container!.querySelectorAll('button'));
    const btn = buttons.find((b) => /償却/.test(b.textContent ?? '') && !b.disabled);
    btn!.click();
    await waitFor(() => filedYearGuard.pending !== null);
    await filedYearGuard.resolve(false);
    expect(generateYearEndDepreciationMock).not.toHaveBeenCalled();
  });
});
