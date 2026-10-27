import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { getSetting, setSetting } from '../lib/settings';
import { describeStorageError } from '../lib/storage-error';
import { markYearFiled } from '../domain/snapshots';
import { generateOpeningEntries } from '../domain/business-opening';
import { generateYearEndDepreciation, loadEffectiveBusinessDates } from '../domain/depreciation';
import { smallAssetAnnualCap } from '../tax-schema/2026/limits';
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

function bodyText(): string {
  return document.body.textContent ?? '';
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

async function render(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(OpeningSetup, { target: container, props: {} });
  await waitFor(() => container!.querySelector('input[name="jigyoStartDate"]') !== null);
}

async function rerender(): Promise<void> {
  unmount(instance!);
  instance = undefined;
  container!.remove();
  container = undefined;
  await render();
}

async function setDates(start: string, close?: string): Promise<void> {
  setValue(input('jigyoStartDate'), start);
  if (close !== undefined) {
    setValue(input('jigyoCloseDate'), close);
  }
  await tick();
}

async function addExpense(): Promise<void> {
  setValue(input('openingKeihiTitle'), '名刺');
  setValue(input('openingKeihiAmount'), '10000');
  input('openingKeihiAmount')
    .closest('form')!
    .querySelector<HTMLButtonElement>('button[type="submit"]')!
    .click();
  await tick();
}

async function addConverted(name: string, acquisitionDate: string): Promise<void> {
  setValue(input('convertedAssetTitle'), name);
  setValue(input('convertedAssetAcquisitionDate'), acquisitionDate);
  setValue(input('convertedAssetAcquisitionCost'), '300000');
  setValue(input('convertedAssetUsefulLife'), '4');
  await tick();
  input('convertedAssetTitle')
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

async function seedOpening(start: string, assetName?: string): Promise<void> {
  await generateOpeningEntries(
    {
      businessStartDate: start,
      expenses: [{ name: '名刺', amount: '10000' }],
      expenseAmortization: 'immediate',
      convertedAssets: assetName
        ? [
            {
              name: assetName,
              acquisitionDate: `${Number(start.slice(0, 4)) - 2}-01-01`,
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

describe('開業日より後に取得した転用資産（G4）', () => {
  test('追加の欄で取得日が開業日より後なら理由を示して追加しない', async () => {
    await render();
    await setDates('2026-07-01', '');
    await addConverted('未来PC', '2026-08-01');
    expect(text()).toContain(
      m.opening_asset_acquired_after_start({
        acquisitionDate: '2026-08-01',
        businessStartDate: '2026-07-01',
      }),
    );
    expect(
      [...container!.querySelectorAll('li')].some((li) => li.textContent?.includes('未来PC')),
    ).toBe(false);
  });

  test('追加後に開業日を前へ動かすと、その行に理由を示し、作成を押せず、押しても書かない', async () => {
    await render();
    await setDates('2026-07-01', '');
    await addConverted('私用PC', '2026-05-01');
    await setDates('2026-04-01');
    const reason = m.fixed_asset_invalid({
      name: '私用PC',
      reasons: m.opening_asset_acquired_after_start({
        acquisitionDate: '2026-05-01',
        businessStartDate: '2026-04-01',
      }),
    });
    expect(text()).toContain(reason);
    await preview();
    expect(confirmButton().disabled).toBe(true);
    confirmButton().click();
    await new Promise((r) => setTimeout(r, 100));
    expect(await db.journalEntries.count()).toBe(0);
    expect(await db.fixedAssets.count()).toBe(0);
  });
});

describe('開業日・廃業日の設定値（G6・G7）', () => {
  test('この年の開業仕訳が既にあり作らなかったときは、開業日・廃業日の設定を変えない', async () => {
    await seedOpening('2026-07-01');
    await setSetting('businessStartDate', '2026-07-01');
    await render();
    await setDates('2026-08-01', '2026-12-31');
    await addExpense();
    await preview();
    confirmButton().click();
    await waitFor(() => text().includes(m.opening_already_exists()));
    expect(await getSetting('businessStartDate')).toBe('2026-07-01');
    expect(await getSetting('businessCloseDate')).toBeUndefined();
  });

  test('廃業日を空欄で作成したら、開業日以後の保存済みの廃業日を消す', async () => {
    await setSetting('businessCloseDate', '2026-12-31');
    await render();
    await setDates('2026-07-01', '');
    await addExpense();
    await preview();
    confirmButton().click();
    await waitFor(() => text().includes(m.opening_done_message()));
    expect(await getSetting('businessStartDate')).toBe('2026-07-01');
    expect(await getSetting('businessCloseDate')).toBeUndefined();
  });

  test('保存済みの日付を読めなかったら作成を押せず、保存済みの廃業日はそのまま', async () => {
    await setSetting('businessCloseDate', '2026-12-31');
    const failure = new Error('開業仕訳の読み込み失敗');
    const original = db.journalEntries.orderBy.bind(db.journalEntries);
    vi.spyOn(db.journalEntries, 'orderBy').mockImplementation((index) => {
      if (index === 'date') {
        throw failure;
      }
      return original(index);
    });
    await render();
    expect(text()).toContain(m.opening_preload_failed({ reason: describeStorageError(failure) }));
    await setDates('2026-07-01', '');
    await addExpense();
    await preview();
    expect(confirmButton().disabled).toBe(true);
    confirmButton().click();
    await new Promise((r) => setTimeout(r, 100));
    expect(await db.journalEntries.count()).toBe(0);
    expect(await getSetting('businessCloseDate')).toBe('2026-12-31');
  });

  test('保存済みの有効な開業日を入れておき、読めない廃業日 2026/07/01 は入れずに作成できる', async () => {
    await setSetting('businessStartDate', '2026-03-01');
    await setSetting('businessCloseDate', '2026/07/01');
    await render();
    expect(input('jigyoStartDate').value).toBe('2026-03-01');
    expect(input('jigyoCloseDate').value).toBe('');
    await addExpense();
    await preview();
    expect(confirmButton().disabled).toBe(false);
    confirmButton().click();
    await waitFor(() => text().includes(m.opening_done_message()));
  });

  test('開業仕訳があれば最も新しい年の開業仕訳の日付を開業日に入れる', async () => {
    await seedOpening('2023-04-01');
    await seedOpening('2026-07-01');
    await setSetting('businessStartDate', '2025-01-01');
    await render();
    expect(input('jigyoStartDate').value).toBe('2026-07-01');
  });

  test('読み込みが終わるまで欄を出さず、入れた後に設定が変わっても入力を書き換えない', async () => {
    await setSetting('businessStartDate', '2026-03-01');
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const original = db.journalEntries.orderBy.bind(db.journalEntries);
    vi.spyOn(db.journalEntries, 'orderBy').mockImplementation((index) => {
      if (index === 'date') {
        return {
          filter: (fn: Parameters<ReturnType<typeof original>['filter']>[0]) => ({
            toArray: async () => {
              await gate;
              return original('date').filter(fn).toArray();
            },
          }),
        } as unknown as ReturnType<typeof original>;
      }
      return original(index);
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(OpeningSetup, { target: container, props: {} });
    await waitFor(() => container!.querySelector('h2') !== null);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('input[name="jigyoStartDate"]')).toBeNull();
    release();
    await waitFor(() => container!.querySelector('input[name="jigyoStartDate"]') !== null);
    expect(input('jigyoStartDate').value).toBe('2026-03-01');
    await setDates('2026-09-01');
    await setSetting('businessStartDate', '2026-05-01');
    await new Promise((r) => setTimeout(r, 100));
    expect(input('jigyoStartDate').value).toBe('2026-09-01');
  });
});

describe('ほかの年に開業仕訳があるときの作成（G9）', () => {
  test('別の年に開業仕訳があれば選ばせ、開業日の変更ならその年を打ち消して作る。確認は 1 度だけ', async () => {
    await seedOpening('2026-07-01', '旧PC');
    const seeded = (await openingEntries(2026)).length;
    await render();
    expect(input('jigyoStartDate').value).toBe('2026-07-01');
    await setDates('2025-10-01', '');
    await addConverted('新PC', '2024-01-01');
    await preview();

    confirmButton().click();
    await waitFor(() => bodyText().includes(m.opening_cross_year_change({ year: 2026 })));
    expect(bodyText()).toContain(m.opening_cross_year_restart({ year: 2026 }));
    buttonByText(document.body, m.common_cancel())!.click();
    await waitFor(() => !bodyText().includes(m.opening_cross_year_change({ year: 2026 })));
    expect(await openingEntries(2025)).toHaveLength(0);
    expect(await openingEntries(2026)).toHaveLength(seeded);

    confirmButton().click();
    await waitFor(
      () => buttonByText(document.body, m.opening_cross_year_change({ year: 2026 })) !== undefined,
    );
    buttonByText(document.body, m.opening_cross_year_change({ year: 2026 }))!.click();
    const desc = m.opening_redo_confirm_desc({ reverseYear: 2026, createYear: 2025 });
    await waitFor(() => bodyText().includes(desc));
    buttonByText(document.body, m.common_cancel())!.click();
    await waitFor(() => !bodyText().includes(desc));
    expect(await openingEntries(2026)).toHaveLength(seeded);

    const confirm = vi.spyOn(filedYearGuard, 'confirm');
    confirmButton().click();
    await waitFor(
      () => buttonByText(document.body, m.opening_cross_year_change({ year: 2026 })) !== undefined,
    );
    buttonByText(document.body, m.opening_cross_year_change({ year: 2026 }))!.click();
    await waitFor(() => buttonByText(document.body, m.opening_redo_confirm_action()) !== undefined);
    buttonByText(document.body, m.opening_redo_confirm_action())!.click();
    await waitFor(() => text().includes(m.opening_done_message()));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(await openingEntries(2026)).toHaveLength(0);
    expect(await openingEntries(2026, 'reversed')).toHaveLength(seeded);
    expect((await openingEntries(2025)).length).toBeGreaterThan(0);
    const assets = await db.fixedAssets.toArray();
    expect(assets.map((a) => [a.name, a.openingYear])).toEqual([['新PC', 2025]]);
  });

  test('打ち消す年の資産に償却仕訳があれば、打ち消さずに作らない', async () => {
    await seedOpening('2026-07-01', '旧PC');
    await generateYearEndDepreciation(2026, { allowFiledYear: true });
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
    buttonByText(document.body, m.opening_redo_confirm_action())!.click();
    await waitFor(() => text().includes(m.opening_redo_blocked({ assets: '旧PC' })));
    expect(await openingEntries(2026)).toHaveLength(seeded);
    expect(await openingEntries(2025)).toHaveLength(0);
  });

  test('再開業として作ると前の期間を残し、各年を自分の日付で月割する。のちの作り直しは打ち消す年だけ', async () => {
    await seedOpening('2023-04-01', '2023のPC');
    await generateYearEndDepreciation(2023, { allowFiledYear: true });
    await setSetting('businessCloseDate', '2024-03-31');
    await render();
    expect(input('jigyoStartDate').value).toBe('2023-04-01');
    expect(input('jigyoCloseDate').value).toBe('2024-03-31');
    await setDates('2026-07-01', '');
    await addExpense();
    await preview();
    confirmButton().click();
    await waitFor(
      () => buttonByText(document.body, m.opening_cross_year_restart({ year: 2023 })) !== undefined,
    );
    buttonByText(document.body, m.opening_cross_year_restart({ year: 2023 }))!.click();
    await waitFor(() => text().includes(m.opening_done_message()));
    const seeded2023 = (await openingEntries(2023)).length;
    expect(seeded2023).toBeGreaterThan(0);
    expect(await openingEntries(2023, 'reversed')).toHaveLength(0);
    expect((await openingEntries(2026)).length).toBeGreaterThan(0);
    expect(await getSetting('businessCloseDate')).toBe('2024-03-31');
    const dates = await loadEffectiveBusinessDates();
    expect(dates).toEqual({
      businessStartDates: ['2023-04-01', '2026-07-01'],
      businessCloseDate: '2024-03-31',
    });
    expect(
      smallAssetAnnualCap(2023, dates.businessStartDates, dates.businessCloseDate).toString(),
    ).toBe('2250000');
    expect(
      smallAssetAnnualCap(2024, dates.businessStartDates, dates.businessCloseDate).toString(),
    ).toBe('750000');
    expect(
      smallAssetAnnualCap(2026, dates.businessStartDates, dates.businessCloseDate).toString(),
    ).toBe('1500000');

    await lockYears(2024);
    await rerender();
    expect(input('jigyoStartDate').value).toBe('2026-07-01');
    expect(input('jigyoCloseDate').value).toBe('');
    await setDates('2026-07-01', '2027-06-30');
    await addExpense();
    await preview();
    expect(text()).toContain(
      m.opening_close_date_replace_notice({ old: '2024-03-31', year: 2024 }),
    );
    confirmButton().click();
    await waitFor(() => filedYearGuard.pending !== null);
    expect(filedYearGuard.pending?.years).toEqual([2024]);
    await filedYearGuard.resolve(true);
    await waitFor(() => buttonByText(container!, m.opening_redo_button()) !== undefined);
    buttonByText(container!, m.opening_redo_button())!.click();
    const desc = m.opening_redo_confirm_desc({ reverseYear: 2026, createYear: 2026 });
    await waitFor(() => bodyText().includes(desc));
    buttonByText(document.body, m.opening_redo_confirm_action())!.click();
    await waitFor(() => filedYearGuard.pending !== null);
    expect(filedYearGuard.pending?.years).toEqual([2024]);
    await filedYearGuard.resolve(true);
    await waitFor(() => text().includes(m.opening_done_message()));
    expect(await openingEntries(2023)).toHaveLength(seeded2023);
    expect((await openingEntries(2026, 'reversed')).length).toBeGreaterThan(0);
    expect((await openingEntries(2026)).length).toBeGreaterThan(0);
    expect((await db.fixedAssets.toArray()).map((a) => a.name)).toEqual(['2023のPC']);
    expect(await getSetting('businessCloseDate')).toBe('2027-06-30');
  });

  test('同じ年に廃業 3/31 して 7/1 に再開業しても作成でき、その年の減価償却は 9 か月分の枠で止まらない', async () => {
    await seedOpening('2025-04-01');
    await setSetting('businessCloseDate', '2026-03-31');
    await render();
    await setDates('2026-07-01', '');
    await addExpense();
    await preview();
    confirmButton().click();
    await waitFor(
      () => buttonByText(document.body, m.opening_cross_year_restart({ year: 2025 })) !== undefined,
    );
    buttonByText(document.body, m.opening_cross_year_restart({ year: 2025 }))!.click();
    await waitFor(() => text().includes(m.opening_done_message()));
    expect(await getSetting('businessCloseDate')).toBe('2026-03-31');
    await db.fixedAssets.bulkAdd(
      [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({
        id: `asset-${i}`,
        name: `PC${i}`,
        acquisitionDate: `2026-08-0${i}`,
        acquisitionCost: '290000',
        usefulLifeYears: 4,
        depreciationMethod: 'small-asset-special' as const,
        accountCode: '1510',
      })),
    );
    const r = await generateYearEndDepreciation(2026, { allowFiledYear: true });
    expect(r.created).toBe(8);
    expect(r.smallAssetCapExceeded).toBe(1);
  });
});
