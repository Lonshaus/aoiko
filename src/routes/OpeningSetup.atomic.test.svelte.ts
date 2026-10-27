// 作り直し・作成の書き込みを 1 つの取引にまとめる（H1・H2・H3）。
// A 類：修正前に失敗するもの（最初に失敗するのは DB の中身の断言）。B 類：修正前後とも通るもの。
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { getSetting, setSetting } from '../lib/settings';
import { markYearFiled } from '../domain/snapshots';
import { generateOpeningEntries, removeOpeningEntries } from '../domain/business-opening';
import { filedYearGuard } from '../lib/filed-year-guard.svelte';
import { m } from '../paraglide/messages';
import type { ReportSnapshotData } from '../db/types';

const { default: OpeningSetup } = await import('./OpeningSetup.svelte');

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 4000,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function text(): string {
  return container?.textContent ?? '';
}

function buttonByText(root: ParentNode, label: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  );
}

function input(name: string): HTMLInputElement {
  return container!.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
}

function setValue(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function byTestId(id: string): HTMLElement | null {
  return container!.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

async function render(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(OpeningSetup, { target: container, props: {} });
  await waitFor(() => container!.querySelector('input[name="jigyoStartDate"]') !== null);
}

async function setDates(start: string, close?: string): Promise<void> {
  setValue(input('jigyoStartDate'), start);
  if (close !== undefined) {
    setValue(input('jigyoCloseDate'), close);
  }
  await tick();
}

async function addExpense(amount = '10000'): Promise<void> {
  setValue(input('openingKeihiTitle'), '名刺');
  setValue(input('openingKeihiAmount'), amount);
  input('openingKeihiAmount')
    .closest('form')!
    .querySelector<HTMLButtonElement>('button[type="submit"]')!
    .click();
  await tick();
}

async function preview(): Promise<void> {
  buttonByText(container!, m.opening_action_preview())!.click();
  await tick();
}

function confirmButton(): HTMLButtonElement {
  return buttonByText(container!, m.opening_action_confirm())!;
}

async function seedOpening(start: string, withAsset = false): Promise<void> {
  await generateOpeningEntries(
    {
      businessStartDate: start,
      expenses: [{ name: '名刺', amount: '10000' }],
      expenseAmortization: 'immediate',
      convertedAssets: withAsset
        ? [
            {
              name: '私用PC',
              acquisitionDate: '2024-01-01',
              acquisitionCost: '300000',
              usefulLifeYears: 4,
              accountCode: '1510',
              depreciationMethod: 'straight-line',
            },
          ]
        : [],
      customItems: [],
    },
    { allowFiledYear: true },
  );
}

async function lockYears(...years: number[]): Promise<void> {
  const pl: ReportSnapshotData & { type: 'pl' } = {
    type: 'pl',
    data: { rows: [], totalRevenue: '0', totalExpense: '0', netIncome: '0' },
  };
  const monthlySales: ReportSnapshotData & { type: 'monthly-sales' } = {
    type: 'monthly-sales',
    data: { months: [] },
  };
  for (const y of years) {
    await markYearFiled(y, { monthlySales, pl }, `${y}-12-31`);
  }
}

async function openingEntries(year: number, status: 'confirmed' | 'reversed' = 'confirmed') {
  return (await db.journalEntries.where('year').equals(year).toArray()).filter(
    (e) => e.source === 'opening' && e.status === status && e.originalEntryId === undefined,
  );
}

async function reversalCount(): Promise<number> {
  return (await db.journalEntries.toArray()).filter((e) => e.originalEntryId !== undefined).length;
}

async function openingAssetCount(): Promise<number> {
  return (await db.fixedAssets.toArray()).filter((a) => a.source === 'opening').length;
}

async function reachAlreadyExists(start: string, amount?: string): Promise<void> {
  await render();
  await setDates(start, '');
  await addExpense(amount);
  await preview();
  confirmButton().click();
  await waitFor(() => buttonByText(container!, m.opening_redo_button()) !== undefined);
}

async function clickRedoConfirm(): Promise<void> {
  buttonByText(container!, m.opening_redo_button())!.click();
  await waitFor(() => buttonByText(document.body, m.opening_redo_confirm_action()) !== undefined);
  buttonByText(document.body, m.opening_redo_confirm_action())!.click();
}

function failPut(key: string): void {
  const original = db.settings.put.bind(db.settings);
  vi.spyOn(db.settings, 'put').mockImplementation(((
    row: Parameters<typeof original>[0],
    k?: Parameters<typeof original>[1],
  ) =>
    row.key === key
      ? Promise.reject(new Error('設定の書き込み失敗（試験）'))
      : original(row, k)) as typeof original);
}

beforeEach(async () => {
  filedYearGuard.pending = null;
  await db.delete();
  await db.open();
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  container?.remove();
  container = undefined;
  filedYearGuard.pending = null;
  await db.delete();
});

describe('A 類：作り直しは打消し・作成・設定値をまとめて書く（H1）', () => {
  test('R1：作成の明細の書き込みが失敗したら、開業仕訳は確定のまま、打消し仕訳も無く、資産も設定値も残る', async () => {
    await seedOpening('2026-07-01', true);
    await setSetting('businessStartDate', '2026-07-01');
    await reachAlreadyExists('2026-07-01');
    vi.spyOn(db.journalLines, 'bulkAdd').mockRejectedValue(new Error('明細の書き込み失敗（試験）'));
    await clickRedoConfirm();
    await waitFor(() => text().includes('明細の書き込み失敗（試験）'));
    expect(await openingEntries(2026, 'reversed')).toHaveLength(0);
    expect(await openingEntries(2026)).toHaveLength(3);
    expect(await reversalCount()).toBe(0);
    expect(await openingAssetCount()).toBe(1);
    expect(await getSetting('businessStartDate')).toBe('2026-07-01');
    expect(byTestId('opening-write-failed-nothing-changed')).not.toBeNull();
    expect(text()).toContain(m.opening_write_failed_nothing_changed());
  });

  test('作り直しで作る項目が無ければ打ち消さず、その旨を示す', async () => {
    await seedOpening('2026-07-01');
    await reachAlreadyExists('2026-07-01', '0');
    await clickRedoConfirm();
    await waitFor(
      () => text().includes(m.opening_done_message()) || byTestId('opening-error') !== null,
    );
    await tick();
    expect(await openingEntries(2026, 'reversed')).toHaveLength(0);
    expect(await openingEntries(2026)).toHaveLength(2);
    expect(text()).toContain(m.opening_redo_empty());
  });

  test('作り直しで、申告済みの確認の間にほかの画面で廃業日が変わったら書かない', async () => {
    await seedOpening('2026-07-01');
    await setSetting('businessCloseDate', '2026-12-31');
    await lockYears(2026);
    await render();
    await setDates('2026-07-01', '');
    await addExpense();
    await preview();
    confirmButton().click();
    await waitFor(() => filedYearGuard.pending !== null);
    await filedYearGuard.resolve(true);
    await waitFor(() => buttonByText(container!, m.opening_redo_button()) !== undefined);
    await clickRedoConfirm();
    await waitFor(() => filedYearGuard.pending !== null);
    await setSetting('businessCloseDate', '2027-03-31');
    await filedYearGuard.resolve(true);
    await waitFor(
      () => text().includes(m.opening_done_message()) || byTestId('opening-error') !== null,
    );
    await tick();
    expect(await openingEntries(2026, 'reversed')).toHaveLength(0);
    expect(await reversalCount()).toBe(0);
    expect(await getSetting('businessCloseDate')).toBe('2027-03-31');
    expect(text()).toContain(m.opening_dates_changed());
  });

  test('作成で、申告済みの確認の間にほかの画面で廃業日が変わったら作らない', async () => {
    await setSetting('businessCloseDate', '2026-12-31');
    await lockYears(2026);
    await render();
    await setDates('2026-07-01', '');
    await addExpense();
    await preview();
    confirmButton().click();
    await waitFor(() => filedYearGuard.pending !== null);
    await setSetting('businessCloseDate', '2027-03-31');
    await filedYearGuard.resolve(true);
    await waitFor(
      () => text().includes(m.opening_done_message()) || byTestId('opening-error') !== null,
    );
    await tick();
    expect(await openingEntries(2026)).toHaveLength(0);
    expect(await getSetting('businessCloseDate')).toBe('2027-03-31');
    expect(await getSetting('businessStartDate')).toBeUndefined();
    expect(text()).toContain(m.opening_dates_changed());
  });
});

describe('A 類：確認の間にほかの画面で作る年の開業仕訳が作られたら打ち消さない（H2）', () => {
  test('S7：2026 を打ち消して 2025 を作る確認の間に 2025 が作られたら、2026 は打ち消さず既存ありを示す', async () => {
    await seedOpening('2026-07-01');
    const seeded = (await openingEntries(2026)).length;
    await render();
    await setDates('2025-10-01', '');
    await addExpense();
    await preview();
    confirmButton().click();
    await waitFor(
      () => buttonByText(document.body, m.opening_cross_year_change({ year: 2026 })) !== undefined,
    );
    buttonByText(document.body, m.opening_cross_year_change({ year: 2026 }))!.click();
    await waitFor(() => buttonByText(document.body, m.opening_redo_confirm_action()) !== undefined);
    await seedOpening('2025-10-01');
    const other = (await openingEntries(2025)).map((e) => e.id).sort();
    buttonByText(document.body, m.opening_redo_confirm_action())!.click();
    await waitFor(() => text().includes(m.opening_already_exists()));
    expect(await openingEntries(2026, 'reversed')).toHaveLength(0);
    expect(await openingEntries(2026)).toHaveLength(seeded);
    expect((await openingEntries(2025)).map((e) => e.id).sort()).toEqual(other);
    expect(buttonByText(container!, m.opening_redo_button())).toBeDefined();
  });
});

describe('A 類：開業日の設定値の書き込みが失敗したら何も書かない（H3）', () => {
  test('R2：作成で開業日の書き込みが失敗したら開業仕訳・資産を作らず、何も変えていないと示す', async () => {
    await render();
    await setDates('2026-07-01', '');
    await addExpense();
    await preview();
    failPut('businessStartDate');
    confirmButton().click();
    await waitFor(() => text().includes('設定の書き込み失敗（試験）'));
    expect(await db.journalEntries.count()).toBe(0);
    expect(await db.fixedAssets.count()).toBe(0);
    expect(text()).not.toContain(m.opening_done_message());
    expect(byTestId('opening-write-failed-nothing-changed')).not.toBeNull();
  });

  test('作り直しで開業日の書き込みが失敗したら打ち消さない', async () => {
    await seedOpening('2026-07-01');
    await reachAlreadyExists('2026-07-01');
    failPut('businessStartDate');
    await clickRedoConfirm();
    await waitFor(() => text().includes('設定の書き込み失敗（試験）'));
    expect(await openingEntries(2026, 'reversed')).toHaveLength(0);
    expect(await reversalCount()).toBe(0);
    expect(await openingEntries(2026)).toHaveLength(2);
    expect(byTestId('opening-write-failed-nothing-changed')).not.toBeNull();
  });
});

describe('B 類：作り直しの回帰', () => {
  test('申告済みの確認の間にその年がほかの画面で打ち消されたら、ここでは打ち消さずに作成へ進む', async () => {
    await seedOpening('2026-07-01');
    const seeded = (await openingEntries(2026)).length;
    await lockYears(2026);
    await render();
    await setDates('2026-07-01', '');
    await addExpense();
    await preview();
    confirmButton().click();
    await waitFor(() => filedYearGuard.pending !== null);
    await filedYearGuard.resolve(true);
    await waitFor(() => buttonByText(container!, m.opening_redo_button()) !== undefined);
    await clickRedoConfirm();
    await waitFor(() => filedYearGuard.pending !== null);
    await removeOpeningEntries(2026, { allowFiledYear: true });
    await filedYearGuard.resolve(true);
    await waitFor(
      async () => text().includes(m.opening_done_message()) || filedYearGuard.pending !== null,
    );
    if (filedYearGuard.pending !== null) {
      await filedYearGuard.resolve(true);
    }
    await waitFor(() => text().includes(m.opening_done_message()));
    expect(await openingEntries(2026, 'reversed')).toHaveLength(seeded);
    expect(await reversalCount()).toBe(seeded);
    expect(await openingEntries(2026)).toHaveLength(2);
  });

  test('作り直しが成功したら、空欄の廃業日で開業日以後の保存済みの廃業日を消し、開業日を書く', async () => {
    await seedOpening('2026-07-01');
    await setSetting('businessCloseDate', '2026-12-31');
    await reachAlreadyExists('2026-08-01');
    await clickRedoConfirm();
    await waitFor(() => text().includes(m.opening_done_message()));
    expect(await openingEntries(2026, 'reversed')).toHaveLength(2);
    expect(await openingEntries(2026)).toHaveLength(2);
    expect(await getSetting('businessStartDate')).toBe('2026-08-01');
    expect(await getSetting('businessCloseDate')).toBeUndefined();
  });
});
