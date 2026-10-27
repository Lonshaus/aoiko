import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { getSetting, setSetting } from '../lib/settings';
import { describeStorageError } from '../lib/storage-error';
import { markYearFiled } from '../domain/snapshots';
import { generateYearEndDepreciation, loadEffectiveBusinessDates } from '../domain/depreciation';
import { smallAssetAnnualCap } from '../tax-schema/2026/limits';
import { filedYearGuard } from '../lib/filed-year-guard.svelte';
import { m } from '../paraglide/messages';
import type { FixedAsset, JournalEntry, ReportSnapshotData } from '../db/types';

const { default: Settings } = await import('./Settings.svelte');

const uncaught: unknown[] = [];
window.addEventListener('error', (e) => uncaught.push(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => uncaught.push(e.reason));

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

const MOUNT_SENTINEL = 'ZZZ9';
let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function text(): string {
  return container?.textContent ?? '';
}

function section(): HTMLElement {
  return container!.querySelector<HTMLElement>('[data-testid="business-dates-section"]')!;
}

function sectionText(): string {
  return section().textContent ?? '';
}

function field(name: string): HTMLInputElement {
  return container!.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
}

function type(name: string, value: string): void {
  const el = field(name);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function buttonByText(label: string, root: ParentNode = container!): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
}

function saveDates(): void {
  buttonByText(m.settings_action_save(), section())!.click();
}

function rowOf(name: string): HTMLTableRowElement {
  return Array.from(container!.querySelectorAll('tbody tr')).find((tr) =>
    tr.querySelector('td')?.textContent?.trim().startsWith(name),
  ) as HTMLTableRowElement;
}

function cell(name: string, index: number): string {
  return rowOf(name).querySelectorAll('td')[index]?.textContent?.trim() ?? '';
}

function yen(s: string): number {
  return Number(s.replace(/[^\d]/g, ''));
}

async function mountSettings(): Promise<void> {
  await db.settings.put({
    key: 'homeOfficeAccountRatios',
    value: { [MOUNT_SENTINEL]: '0.30' },
    updatedAt: Date.now(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Settings, { target: container, props: {} });
  await waitFor(() => text().includes(MOUNT_SENTINEL));
}

function opening(id: string, date: string): JournalEntry {
  return {
    id,
    date,
    year: Number(date.slice(0, 4)),
    description: '開業費計上（開業設定）',
    status: 'confirmed',
    source: 'opening',
    createdAt: 1,
    confirmedAt: 1,
  };
}

function smallAsset(i: number, overrides: Partial<FixedAsset> = {}): FixedAsset {
  return {
    id: `asset-${i}`,
    name: `PC${i}`,
    acquisitionDate: `2026-08-0${i}`,
    acquisitionCost: '290000',
    usefulLifeYears: 4,
    depreciationMethod: 'small-asset-special',
    accountCode: '1510',
    ...overrides,
  };
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

async function screenTotal(names: string[]): Promise<number> {
  await waitFor(() => names.every((n) => cell(n, 4) !== m.common_dash()));
  return names.reduce((s, n) => s + yen(cell(n, 4)), 0);
}

async function bookedTotal(): Promise<number> {
  const lines = await db.journalLines.where('side').equals('debit').toArray();
  return lines.reduce((s, l) => s + Number(l.amount), 0);
}

const SIX = [1, 2, 3, 4, 5, 6];

beforeEach(async () => {
  uncaught.length = 0;
  filedYearGuard.pending = null;
  await db.delete();
  await db.open();
  await setSetting('currentYear', 2026);
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

describe('償却額の表示と仕訳が同じ開業日を使う（G1）', () => {
  test('開業日の設定が無く開業仕訳が 2026-07-01 なら、画面の償却額の合計と書く仕訳の合計はどちらも 1,480,208', async () => {
    await db.journalEntries.add(opening('op', '2026-07-01'));
    await db.fixedAssets.bulkAdd(SIX.map((i) => smallAsset(i)));
    await mountSettings();
    type('depreciationTargetNen', '2026');
    expect(await screenTotal(SIX.map((i) => `PC${i}`))).toBe(1480208);
    buttonByText(m.settings_asset_run_button())!.click();
    await waitFor(() => text().includes(m.settings_asset_run_success({ created: 6 })));
    expect(await bookedTotal()).toBe(1480208);
  });

  test('設定値 2026-01-01 と開業仕訳 2026-07-01 が違えば開業仕訳の日付で計算し、設定値は使わないと示す', async () => {
    await db.journalEntries.add(opening('op', '2026-07-01'));
    await setSetting('businessStartDate', '2026-01-01');
    await db.fixedAssets.bulkAdd(SIX.map((i) => smallAsset(i)));
    await mountSettings();
    type('depreciationTargetNen', '2026');
    expect(await screenTotal(SIX.map((i) => `PC${i}`))).toBe(1480208);
    expect(sectionText()).toContain(m.settings_business_dates_start_unused());
    expect(field('businessStartDateSetting').value).toBe('2026-01-01');
  });

  test('開業日の読み込みに失敗したら理由を示して減価償却を止め、ほかの設定は読む', async () => {
    const failure = new Error('開業仕訳の読み込み失敗');
    const original = db.journalEntries.orderBy.bind(db.journalEntries);
    vi.spyOn(db.journalEntries, 'orderBy').mockImplementation((index) => {
      if (index === 'date') {
        throw failure;
      }
      return original(index);
    });
    await db.fixedAssets.add(smallAsset(1));
    await mountSettings();
    await waitFor(() =>
      text().includes(m.settings_asset_calc_blocked({ reasons: describeStorageError(failure) })),
    );
    expect(buttonByText(m.settings_asset_run_button())!.disabled).toBe(true);
    expect(cell('PC1', 4)).toBe(m.common_dash());
    expect(text()).toContain(MOUNT_SENTINEL);
  });

  test('読み込み中は償却額を出さず、計算できない旨も出さず、減価償却を押せない', async () => {
    const original = db.journalEntries.orderBy.bind(db.journalEntries);
    vi.spyOn(db.journalEntries, 'orderBy').mockImplementation((index) => {
      if (index === 'date') {
        return {
          filter: () => ({ toArray: () => new Promise(() => {}) }),
        } as unknown as ReturnType<typeof original>;
      }
      return original(index);
    });
    await db.fixedAssets.bulkAdd([
      smallAsset(1, { depreciationMethod: 'straight-line', acquisitionDate: '2024-01-01' }),
      smallAsset(2, {
        depreciationMethod: 'straight-line',
        acquisitionDate: '2024-01-01',
        disposedDate: '2026-06-30',
        disposalType: 'sale',
        salePrice: '100000',
      }),
    ]);
    await mountSettings();
    type('depreciationTargetNen', '2026');
    await new Promise((r) => setTimeout(r, 100));
    expect(cell('PC1', 4)).toBe(m.common_dash());
    expect(buttonByText(m.settings_asset_run_button())!.disabled).toBe(true);
    expect(text()).not.toContain(m.settings_asset_calc_blocked({ reasons: '' }).slice(0, 10));
    expect(text()).not.toContain(m.settings_transfer_income_aggregate_title({ year: 2026 }));
    expect(uncaught).toEqual([]);
  });
});

describe('開業日・廃業日の欄（G7）', () => {
  test('年ごとの開業日と出どころを並べ、読めない設定値は元の値と説明を出して直せる', async () => {
    await db.journalEntries.add(opening('op', '2023-05-01'));
    await setSetting('businessStartDate', '2026/07/01');
    await db.fixedAssets.add(smallAsset(1));
    await mountSettings();
    await waitFor(() => section() !== null);
    expect(sectionText()).toContain('2023-05-01');
    expect(sectionText()).toContain(m.settings_business_dates_source_opening_entry());
    expect(sectionText()).toContain(
      m.settings_business_dates_stored_unreadable({ value: '2026/07/01' }),
    );
    expect(field('businessStartDateSetting').value).toBe('');
    expect(text()).toContain(m.business_date_invalid_setting_start({ value: '2026/07/01' }));

    type('businessStartDateSetting', '2026-07-01');
    saveDates();
    await waitFor(async () => (await getSetting('businessStartDate')) === '2026-07-01');
    await waitFor(() => sectionText().includes(m.settings_business_dates_source_setting()));
    await waitFor(
      () => !text().includes(m.business_date_invalid_setting_start({ value: '2026/07/01' })),
    );
    expect(uncaught).toEqual([]);
  });

  test('開業仕訳の無い年の設定値はその年の開業日として使うと示し、空欄で保存すると消えて通年になる', async () => {
    await db.journalEntries.add(opening('op', '2023-05-01'));
    await setSetting('businessStartDate', '2026-07-01');
    await mountSettings();
    await waitFor(() =>
      sectionText().includes(m.settings_business_dates_start_used({ year: 2026 })),
    );
    type('businessStartDateSetting', '');
    saveDates();
    await waitFor(async () => (await getSetting('businessStartDate')) === undefined);
    const { businessStartDates } = await loadEffectiveBusinessDates();
    expect(smallAssetAnnualCap(2026, businessStartDates).toString()).toBe('3000000');
  });

  test('開業仕訳のある年の設定値は使わないと示し、変えても計算が変わらないので確認を出さない', async () => {
    await db.journalEntries.add(opening('op', '2023-04-01'));
    await setSetting('businessStartDate', '2023-05-01');
    await db.fixedAssets.add(smallAsset(1, { acquisitionDate: '2023-06-01' }));
    await db.journalEntries.add({
      ...opening('dep', '2023-12-31'),
      source: 'manual',
      description: '減価償却 PC1 #asset-1',
    });
    await lockYears(2023);
    await mountSettings();
    await waitFor(() => sectionText().includes(m.settings_business_dates_start_unused()));
    const confirm = vi.spyOn(filedYearGuard, 'confirm');
    type('businessStartDateSetting', '2023-06-01');
    saveDates();
    await waitFor(async () => (await getSetting('businessStartDate')) === '2023-06-01');
    expect(confirm).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(m.settings_business_dates_confirm_title());
  });

  test('開業仕訳の日付 2026-02-30 が読めなければその旨を示し、2026 年の開業日を入れると計算が戻る', async () => {
    await db.journalEntries.add(opening('op', '2026-02-30'));
    await db.fixedAssets.add(
      smallAsset(1, { depreciationMethod: 'straight-line', acquisitionDate: '2025-01-01' }),
    );
    await mountSettings();
    type('depreciationTargetNen', '2026');
    const message = m.business_date_invalid_opening_entry({ value: '2026-02-30' });
    await waitFor(() => text().includes(message));
    expect(sectionText()).toContain(
      m.settings_business_dates_opening_entry_unreadable({ value: '2026-02-30' }),
    );
    expect(cell('PC1', 4)).toBe(m.common_dash());
    type('businessStartDateSetting', '2026-03-01');
    saveDates();
    await waitFor(() => !text().includes(message));
    await waitFor(() => cell('PC1', 4) !== m.common_dash());
  });

  test('開業日を変えると、その年から今年まで（2027 を含む）の申告済みを確かめ、取り消せば変えない。償却仕訳があれば重ねて確かめる', async () => {
    await setSetting('currentYear', 2027);
    await setSetting('businessStartDate', '2026-07-01');
    const dates = ['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'];
    await db.fixedAssets.bulkAdd(
      dates.map((d, i) => smallAsset(i + 1, { acquisitionDate: d, acquisitionCost: '390000' })),
    );
    await lockYears(2026, 2027);
    await mountSettings();
    await waitFor(() => field('businessStartDateSetting').value === '2026-07-01');

    type('businessStartDateSetting', '2026-04-01');
    saveDates();
    await waitFor(() => filedYearGuard.pending !== null);
    expect(filedYearGuard.pending?.years).toEqual([2026, 2027]);
    await filedYearGuard.resolve(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(await getSetting('businessStartDate')).toBe('2026-07-01');

    await generateYearEndDepreciation(2026, { allowFiledYear: true });
    saveDates();
    await waitFor(() => filedYearGuard.pending !== null);
    await filedYearGuard.resolve(true);
    await waitFor(() =>
      (document.body.textContent ?? '').includes(m.settings_business_dates_confirm_title()),
    );
    expect(await getSetting('businessStartDate')).toBe('2026-07-01');
    buttonByText(m.settings_business_dates_confirm_action(), document.body)!.click();
    await waitFor(async () => (await getSetting('businessStartDate')) === '2026-04-01');
  });

  test('開業仕訳のある利用者が廃業日を変えても、同じ範囲の申告済みを確かめる', async () => {
    await setSetting('currentYear', 2027);
    await db.journalEntries.add(opening('op', '2026-07-01'));
    await lockYears(2026, 2027);
    await mountSettings();
    await waitFor(() => section() !== null);
    type('businessCloseDateSetting', '2026-12-31');
    saveDates();
    await waitFor(() => filedYearGuard.pending !== null);
    expect(filedYearGuard.pending?.years).toEqual([2026, 2027]);
    await filedYearGuard.resolve(true);
    await waitFor(async () => (await getSetting('businessCloseDate')) === '2026-12-31');
  });
});
