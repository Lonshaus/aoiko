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

const { applyBadDebtReversalMock } = vi.hoisted(() => ({
  applyBadDebtReversalMock: vi.fn().mockResolvedValue({ entryId: 'e1', total: '30000' }),
}));

vi.mock('../domain/bad-debt-reversal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/bad-debt-reversal')>();
  return { ...actual, applyBadDebtReversal: applyBadDebtReversalMock };
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

function reversalButton(): HTMLButtonElement | undefined {
  return Array.from(container!.querySelectorAll('button')).find(
    (b) => /繰り戻/.test(b.textContent ?? '') && !b.disabled,
  );
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  applyBadDebtReversalMock.mockClear();
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

describe('runBadDebtReversal: 申告済み年度のロック', () => {
  test('申告済み年度なら確認を挟み、続行を選んで初めて生成する', async () => {
    await markYearFiled(CURRENT_YEAR, { monthlySales, pl }, `${CURRENT_YEAR}-12-31`);
    await waitFor(() => document.querySelectorAll('button').length > 0);
    const btn = reversalButton();
    expect(btn).toBeDefined();
    btn!.click();
    await waitFor(() => filedYearGuard.pending !== null);
    expect(filedYearGuard.pending?.years).toEqual([CURRENT_YEAR]);
    expect(applyBadDebtReversalMock).not.toHaveBeenCalled();
    await filedYearGuard.resolve(true);
    await waitFor(() => applyBadDebtReversalMock.mock.calls.length > 0);
    expect(applyBadDebtReversalMock).toHaveBeenCalledWith(CURRENT_YEAR);
  });

  test('確認で取消を選ぶと生成されない', async () => {
    await markYearFiled(CURRENT_YEAR, { monthlySales, pl }, `${CURRENT_YEAR}-12-31`);
    await waitFor(() => document.querySelectorAll('button').length > 0);
    reversalButton()!.click();
    await waitFor(() => filedYearGuard.pending !== null);
    await filedYearGuard.resolve(false);
    expect(applyBadDebtReversalMock).not.toHaveBeenCalled();
  });

  test('申告済みでなければ確認を挟まずに生成する', async () => {
    await waitFor(() => document.querySelectorAll('button').length > 0);
    reversalButton()!.click();
    await waitFor(() => applyBadDebtReversalMock.mock.calls.length > 0);
    expect(filedYearGuard.pending).toBeNull();
    expect(applyBadDebtReversalMock).toHaveBeenCalledWith(CURRENT_YEAR);
  });
});
