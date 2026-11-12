// 作り直しの途中で止まった年の案内（H6）、その年の開業仕訳を元に戻すことと転用資産の登録し直し（H7）。
// A 類：修正前に失敗するもの（最初に失敗するのは画面の状態か DB の中身の断言）。B 類：修正前後とも通るもの。
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { getSetting, setSetting } from '../lib/settings';
import { markYearFiled } from '../domain/snapshots';
import { generateOpeningEntries, removeOpeningEntries } from '../domain/business-opening';
import { generateYearEndDepreciation } from '../domain/depreciation';
import { reverseEntry } from '../domain/reverse';
import { filedYearGuard } from '../lib/filed-year-guard.svelte';
import { formatJPY, toIndexable } from '../lib/decimal';
import { m } from '../paraglide/messages';
import type { FixedAsset, JournalLine, ReportSnapshotData } from '../db/types';
const ALL_YEARS = Array.from({ length: 80 }, (_, i) => 2020 + i);

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

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
}
// 打消しと作成の入力時刻（createdAt）が同じミリ秒に重ならないようにする
async function later(): Promise<void> {
  await new Promise((r) => setTimeout(r, 5));
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function text(): string {
  return container?.textContent ?? '';
}

function byTestId(id: string, root: ParentNode = container!): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function allByTestId(id: string): HTMLElement[] {
  return [...container!.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
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

function notice(): HTMLElement | null {
  return byTestId('opening-interrupted-years');
}

async function renderAndWaitNotice(): Promise<void> {
  await render();
  await waitFor(() => notice() !== null, 1000).catch(() => {});
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
    { allowedFiledYears: ALL_YEARS },
  );
}
// 修正前の作り直しが作成で止まった後の形（R1 の結果）：開業仕訳は打ち消され、開業資産は消え、作り直した仕訳が無い
async function interrupt(start: string, assetName?: string): Promise<void> {
  await seedOpening(start, assetName);
  await later();
  await removeOpeningEntries(Number(start.slice(0, 4)), { allowedFiledYears: ALL_YEARS });
  await later();
}

async function setCreatedAt(year: number, createdAt: number): Promise<void> {
  const rows = (await db.journalEntries.where('year').equals(year).toArray()).filter(
    (e) => e.source === 'opening' && e.originalEntryId === undefined,
  );
  for (const e of rows) {
    await db.journalEntries.update(e.id, { createdAt });
  }
}

async function reversalTime(year: number): Promise<number> {
  const rows = (await db.journalEntries.where('year').equals(year).toArray()).filter(
    (e) => e.source === 'opening' && e.originalEntryId !== undefined,
  );
  return Math.max(...rows.map((e) => e.createdAt));
}

function line(
  entryId: string,
  id: string,
  side: 'debit' | 'credit',
  accountCode: string,
  amount: string,
  memo: string,
): JournalLine {
  return {
    id,
    entryId,
    side,
    accountCode,
    amount,
    amountIndexed: toIndexable(amount),
    taxRate: 0,
    taxIncluded: false,
    invoiceCompliant: false,
    memo,
  };
}
// 元に戻した開業仕訳（説明の先頭が [再計上]）。転用資産の明細は借方・償却資産の科目・memo が「転用資産：名前」
async function seedRestored(
  year: number,
  date: string,
  items: { name: string; amount: string }[],
): Promise<string> {
  const id = `restored-${year}`;
  await db.journalEntries.add({
    id,
    date,
    year,
    description: '[再計上] 開業時資産計上（開業設定）',
    status: 'confirmed',
    source: 'opening',
    createdAt: 1,
    confirmedAt: 1,
  });
  const total = items.reduce((s, i) => s + Number(i.amount), 0);
  await db.journalLines.bulkAdd([
    ...items.map((i, n) =>
      line(id, `${id}-d${n}`, 'debit', '1510', i.amount, `転用資産：${i.name}`),
    ),
    line(id, `${id}-c`, 'credit', '3110', String(total), '開業（元入金）'),
  ]);
  return id;
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

function bodyButton(id: string): HTMLButtonElement | null {
  return document.body.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
}

async function clickRestore(year: number): Promise<void> {
  byTestId(`opening-restore-${year}`)!.click();
  await waitFor(() => bodyButton('opening-restore-confirm-action') !== null);
  bodyButton('opening-restore-confirm-action')!.click();
}

async function restoredEntries(year: number) {
  return (await db.journalEntries.where('year').equals(year).toArray()).filter(
    (e) => e.status === 'confirmed' && e.description.startsWith('[再計上] '),
  );
}

function missingItems(): HTMLElement[] {
  return allByTestId('opening-missing-asset');
}

function missingItem(name: string): HTMLElement | undefined {
  return missingItems().find((el) => el.textContent?.includes(name));
}

async function openRegister(name: string): Promise<void> {
  byTestId('opening-missing-asset-register', missingItem(name)!)!.click();
  await waitFor(() => container!.querySelector('input[name="missingAssetAcqDate"]') !== null);
}

async function fillAndSubmit(acq: string, cost: string, life: string): Promise<void> {
  setValue(input('missingAssetAcqDate'), acq);
  setValue(input('missingAssetCost'), cost);
  setValue(input('missingAssetLife'), life);
  await settle();
  byTestId('opening-missing-asset-submit')!.click();
  await settle();
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

describe('A 類：作り直しの途中で止まった年を示す（H6）', () => {
  test('R1 の結果（2026 は開業仕訳の打消しだけで有効な開業仕訳が無い）なら 2026 を示す', async () => {
    await interrupt('2026-07-01', '私用PC');
    await renderAndWaitNotice();
    expect(notice()?.textContent ?? '').toContain('2026');
  });

  test('2023 に開業仕訳があり 2026 が止まっていれば 2026 だけを示す', async () => {
    await seedOpening('2023-04-01');
    await later();
    await interrupt('2026-07-01');
    await renderAndWaitNotice();
    expect(byTestId('opening-interrupted-year-2026')).not.toBeNull();
    expect(byTestId('opening-interrupted-year-2023')).toBeNull();
  });

  test('2026→2025 の開業日の変更が済んだ後に 2025 の作り直しが止まったら 2025 だけを示す', async () => {
    await interrupt('2026-07-01');
    await seedOpening('2025-10-01');
    await setCreatedAt(2025, await reversalTime(2026));
    await later();
    await removeOpeningEntries(2025, { allowedFiledYears: ALL_YEARS });
    await renderAndWaitNotice();
    expect(byTestId('opening-interrupted-year-2025')).not.toBeNull();
    expect(byTestId('opening-interrupted-year-2026')).toBeNull();
  });

  test('修正前の作り直しで 2 度目の確認を取り消して残った形（打消しのみ）も示す', async () => {
    await interrupt('2026-07-01');
    await renderAndWaitNotice();
    expect(byTestId('opening-interrupted-year-2026')).not.toBeNull();
  });

  test('止まった後に 2027 に再開業しても 2026 は示したまま', async () => {
    await interrupt('2026-07-01');
    await seedOpening('2027-04-01');
    await renderAndWaitNotice();
    expect(byTestId('opening-interrupted-year-2026')).not.toBeNull();
    expect(byTestId('opening-interrupted-year-2027')).toBeNull();
  });

  test('「表示しない」は確かめてからその年を隠し、「非表示にした年を表示」で戻す', async () => {
    await interrupt('2026-07-01');
    await renderAndWaitNotice();
    expect(byTestId('opening-dismiss-2026')).not.toBeNull();
    byTestId('opening-dismiss-2026')!.click();
    await waitFor(() => bodyButton('opening-dismiss-confirm-action') !== null);
    expect(document.body.textContent).toContain(
      m.opening_interrupted_dismiss_confirm_title({ year: 2026 }),
    );
    expect(document.body.textContent).toContain(m.opening_interrupted_dismiss_confirm_desc());
    bodyButton('opening-dismiss-confirm-action')!.click();
    await waitFor(() => notice() === null);
    expect(await getSetting('dismissedInterruptedOpeningYears')).toEqual([2026]);
    expect(byTestId('opening-show-dismissed')?.textContent).toContain(
      m.opening_interrupted_show_dismissed({ count: 1 }),
    );
    byTestId('opening-show-dismissed')!.click();
    await waitFor(() => notice() !== null);
    expect(byTestId('opening-interrupted-year-2026')).not.toBeNull();
  });
});

describe('B 類：止まっていない年は示さない（H6）', () => {
  test('2026 を打ち消して 2025 を作る開業日の変更が同じ取引で済んでいれば示さない', async () => {
    await interrupt('2026-07-01');
    await seedOpening('2025-10-01');
    await setCreatedAt(2025, await reversalTime(2026));
    await render();
    await settle();
    expect(notice()).toBeNull();
  });

  test('仕訳一覧で打ち消した開業仕訳（打消しの source は manual）は示さない', async () => {
    await seedOpening('2026-07-01');
    for (const e of await db.journalEntries.toArray()) {
      await reverseEntry(e.id, { allowedFiledYears: ALL_YEARS });
    }
    await render();
    await settle();
    expect(notice()).toBeNull();
  });

  test('作り直しが済んだ後に新しい開業仕訳を仕訳一覧で打ち消しても示さない', async () => {
    await interrupt('2026-07-01');
    await seedOpening('2026-07-01');
    const created = (await db.journalEntries.toArray()).filter(
      (e) => e.source === 'opening' && e.status === 'confirmed' && e.originalEntryId === undefined,
    );
    for (const e of created) {
      await reverseEntry(e.id, { allowedFiledYears: ALL_YEARS });
    }
    await render();
    await settle();
    expect(notice()).toBeNull();
  });

  test('開業仕訳の打消しの入力時刻が読めなければ示さない', async () => {
    await interrupt('2026-07-01');
    for (const e of await db.journalEntries.toArray()) {
      if (e.originalEntryId !== undefined) {
        await db.journalEntries.update(e.id, { createdAt: 'x' as never });
      }
    }
    await render();
    await settle();
    expect(notice()).toBeNull();
  });

  test('仕訳を読めなくても案内を出さないだけで、ほかの部分は使える', async () => {
    await interrupt('2026-07-01');
    vi.spyOn(db.journalEntries, 'each').mockRejectedValue(new Error('読み込み失敗（試験）'));
    await render();
    await settle();
    expect(notice()).toBeNull();
    expect(input('jigyoStartDate')).not.toBeNull();
    expect(text()).toContain(m.opening_expense_title());
  });

  test('表示しない資産の設定を読めなければ、登録し直す資産の読み込み失敗を示す', async () => {
    await seedOpening('2026-07-01', '私用PC');
    const original = db.settings.get.bind(db.settings);
    vi.spyOn(db.settings, 'get').mockImplementation(((key: unknown, ...rest: unknown[]) =>
      key === 'dismissedMissingOpeningAssets'
        ? Promise.reject(new Error('読み込み失敗（試験）'))
        : (original as (...a: unknown[]) => unknown)(key, ...rest)) as never);
    await render();
    await waitFor(
      () =>
        text().includes(m.opening_missing_assets_load_failed({ reason: '読み込み失敗（試験）' })),
      1000,
    ).catch(() => {});
    expect(text()).toContain(
      m.opening_missing_assets_load_failed({ reason: '読み込み失敗（試験）' }),
    );
    expect(input('jigyoStartDate')).not.toBeNull();
  });

  test('元に戻した開業仕訳が無ければ、印や開業年の無い旧い開業資産があっても登録し直す資産を出さない', async () => {
    await seedOpening('2026-07-01', '私用PC');
    const asset = (await db.fixedAssets.toArray())[0]!;
    const { source: _s, openingYear: _y, serviceStartDate: _d, ...legacy } = asset;
    await db.fixedAssets.put({ ...legacy, acquisitionDate: '2026-07-01' });
    await db.fixedAssets.add({ ...legacy, id: 'no-year', source: 'opening' } as FixedAsset);
    await render();
    await settle();
    expect(byTestId('opening-missing-assets')).toBeNull();
  });
});

describe('A 類：止まった年の開業仕訳を元に戻す（H7）', () => {
  test('R1 の結果を元に戻すと 2026 に [再計上] の開業仕訳が 3 本でき、元の仕訳は変わらず、案内が消えて転用資産の登録を促す', async () => {
    await interrupt('2026-07-01', '私用PC');
    const before = await db.journalEntries.toArray();
    const beforeLines = await db.journalLines.toArray();
    await renderAndWaitNotice();
    expect(byTestId('opening-restore-2026')).not.toBeNull();
    await clickRestore(2026);
    await waitFor(async () => (await restoredEntries(2026)).length > 0);
    await settle();
    const restored = await restoredEntries(2026);
    expect(restored).toHaveLength(3);
    for (const e of restored) {
      const orig = before.find(
        (o) => o.originalEntryId === undefined && `[再計上] ${o.description}` === e.description,
      )!;
      expect(e.source).toBe('opening');
      expect(e.date).toBe(orig.date);
      expect(e.reversedByEntryId).toBeUndefined();
      const strip = ({ id: _i, entryId: _e, ...rest }: JournalLine) => rest;
      const lines = (await db.journalLines.where('entryId').equals(e.id).toArray()).map(strip);
      const origLines = beforeLines.filter((l) => l.entryId === orig.id).map(strip);
      expect(lines.sort((a, b) => a.memo!.localeCompare(b.memo!))).toEqual(
        origLines.sort((a, b) => a.memo!.localeCompare(b.memo!)),
      );
    }
    for (const b of before) {
      expect(await db.journalEntries.get(b.id)).toEqual(b);
    }
    await waitFor(() => notice() === null);
    const assetLine = beforeLines.find((l) => l.memo === '転用資産：私用PC')!;
    expect(missingItem('私用PC')?.textContent).toContain(formatJPY(assetLine.amount));
  });

  test('2023 と 2026 が止まっていれば、2026 を元に戻した後も 2023 を示し、元に戻せる', async () => {
    await interrupt('2023-04-01');
    await interrupt('2026-07-01');
    await renderAndWaitNotice();
    expect(byTestId('opening-restore-2026')).not.toBeNull();
    await clickRestore(2026);
    await waitFor(async () => (await restoredEntries(2026)).length > 0);
    await waitFor(() => byTestId('opening-interrupted-year-2026') === null);
    expect(byTestId('opening-interrupted-year-2023')).not.toBeNull();
    await clickRestore(2023);
    await waitFor(async () => (await restoredEntries(2023)).length > 0);
    await waitFor(() => notice() === null);
  });

  test('申告済みの年は確かめてから元に戻し、取り消せば書かない', async () => {
    await interrupt('2026-07-01');
    await lockYears(2026);
    await renderAndWaitNotice();
    expect(byTestId('opening-restore-2026')).not.toBeNull();
    await clickRestore(2026);
    await waitFor(() => filedYearGuard.pending !== null);
    expect(filedYearGuard.pending?.years).toEqual([2026]);
    await filedYearGuard.resolve(false);
    await settle();
    expect(await restoredEntries(2026)).toHaveLength(0);
    await clickRestore(2026);
    await waitFor(() => filedYearGuard.pending !== null);
    await filedYearGuard.resolve(true);
    await waitFor(async () => (await restoredEntries(2026)).length === 2);
  });

  test('確かめる画面に、戻す仕訳と [再計上] の印、今日の入力日、資産の登録し直しを示す', async () => {
    await interrupt('2026-07-01');
    await setSetting('businessStartDate', '2026-08-01');
    await renderAndWaitNotice();
    expect(byTestId('opening-restore-2026')).not.toBeNull();
    byTestId('opening-restore-2026')!.click();
    await waitFor(() => bodyButton('opening-restore-confirm-action') !== null);
    const dialog = document.body.textContent ?? '';
    expect(dialog).toContain('開業費計上（開業設定）');
    expect(dialog).toContain(formatJPY('10000'));
    expect(dialog).toContain(m.opening_restore_confirm_desc());
    expect(dialog).toContain(
      m.opening_restore_date_differs({ entryDate: '2026-07-01', settingDate: '2026-08-01' }),
    );
  });
});

describe('元に戻す開業仕訳の金額が読めないとき', () => {
  test('確かめる画面は金額を「—」と表示し、原文を出さず、確認の実行では書かない', async () => {
    await interrupt('2026-07-01');
    await db.journalLines.toCollection().modify((l) => {
      l.amount = 'abc';
    });
    await renderAndWaitNotice();
    byTestId('opening-restore-2026')!.click();
    await waitFor(() => bodyButton('opening-restore-confirm-action') !== null);
    const row = byTestId('opening-restore-confirm', document.body)!;
    expect(row.textContent).toContain(
      m.opening_restore_entry_row({
        description: '開業費計上（開業設定）',
        amount: m.common_dash(),
      }),
    );
    expect(document.body.textContent).not.toContain('DecimalError');
    const before = await db.journalEntries.count();
    bodyButton('opening-restore-confirm-action')!.click();
    await settle();
    expect(await db.journalEntries.count()).toBe(before);
    expect(text()).toContain(m.opening_restore_amount_invalid());
  });
});

describe('A 類：元に戻した年の転用資産を登録し直す（H7）', () => {
  test('取得日・取得価額・耐用年数を入れると、仕訳の額を開業時の未償却残高として登録し、一覧から消え、年末の償却に使われる', async () => {
    await seedRestored(2026, '2026-07-01', [{ name: '私用PC', amount: '165540' }]);
    await render();
    await waitFor(() => missingItem('私用PC') !== undefined, 1000).catch(() => {});
    expect(missingItem('私用PC')).toBeDefined();
    await openRegister('私用PC');
    await fillAndSubmit('2024-01-01', '300000', '4');
    await waitFor(async () => (await db.fixedAssets.count()) === 1);
    const asset = (await db.fixedAssets.toArray())[0]!;
    expect(asset).toMatchObject({
      name: '私用PC',
      accountCode: '1510',
      acquisitionDate: '2024-01-01',
      acquisitionCost: '300000',
      usefulLifeYears: 4,
      source: 'opening',
      openingYear: 2026,
      serviceStartDate: '2026-07-01',
      conversionBasis: '165540',
    });
    await waitFor(() => missingItem('私用PC') === undefined);
    await generateYearEndDepreciation(2026, { allowedFiledYears: ALL_YEARS });
    const dep = (await db.journalEntries.toArray()).find((e) =>
      e.description.includes(`#${asset.id.slice(0, 8)}`),
    );
    expect(dep).toBeDefined();
  });

  test('取得日が開業日より後・耐用年数 68・取得価額が仕訳の額より小さいときは登録しない', async () => {
    await seedRestored(2026, '2026-07-01', [{ name: '私用PC', amount: '165540' }]);
    await render();
    await waitFor(() => missingItem('私用PC') !== undefined, 1000).catch(() => {});
    expect(missingItem('私用PC')).toBeDefined();
    await openRegister('私用PC');
    await fillAndSubmit('2026-08-01', '300000', '4');
    expect(await db.fixedAssets.count()).toBe(0);
    expect(byTestId('opening-missing-asset-error')?.textContent).toContain(
      m.opening_asset_acquired_after_start({
        acquisitionDate: '2026-08-01',
        businessStartDate: '2026-07-01',
      }),
    );
    await fillAndSubmit('2024-01-01', '300000', '68');
    expect(await db.fixedAssets.count()).toBe(0);
    expect(byTestId('opening-missing-asset-error')?.textContent).toContain(
      m.opening_asset_life_unsupported(),
    );
    await fillAndSubmit('2024-01-01', '100000', '4');
    expect(await db.fixedAssets.count()).toBe(0);
    expect(byTestId('opening-missing-asset-error')?.textContent).toContain(
      m.opening_missing_assets_cost_below_basis({ basis: formatJPY('165540') }),
    );
  });

  test('入力から計算した額が仕訳の額と違えば両方を示し、確かめてから仕訳の額で登録する', async () => {
    await seedRestored(2026, '2026-07-01', [{ name: '私用PC', amount: '170000' }]);
    await render();
    await waitFor(() => missingItem('私用PC') !== undefined, 1000).catch(() => {});
    expect(missingItem('私用PC')).toBeDefined();
    await openRegister('私用PC');
    await fillAndSubmit('2024-01-01', '300000', '4');
    expect(await db.fixedAssets.count()).toBe(0);
    expect(byTestId('opening-missing-asset-basis-differs')?.textContent).toContain(
      m.opening_missing_assets_basis_differs({
        computed: formatJPY('165540'),
        booked: formatJPY('170000'),
      }),
    );
    byTestId('opening-missing-asset-submit-anyway')!.click();
    await waitFor(async () => (await db.fixedAssets.count()) === 1);
    expect((await db.fixedAssets.toArray())[0]!.conversionBasis).toBe('170000');
  });

  test('開業年が申告済みなら確かめてから登録する', async () => {
    await seedRestored(2026, '2026-07-01', [{ name: '私用PC', amount: '165540' }]);
    await lockYears(2026);
    await render();
    await waitFor(() => missingItem('私用PC') !== undefined, 1000).catch(() => {});
    expect(missingItem('私用PC')).toBeDefined();
    await openRegister('私用PC');
    await fillAndSubmit('2024-01-01', '300000', '4');
    await waitFor(() => filedYearGuard.pending !== null);
    expect(filedYearGuard.pending?.years).toEqual([2026]);
    await filedYearGuard.resolve(true);
    await waitFor(async () => (await db.fixedAssets.count()) === 1);
  });

  test('同じ名前の 2 本（モニター×2）がどちらも無ければ 2 本示し、1 本登録すると残り 1 本', async () => {
    await seedRestored(2026, '2026-07-01', [
      { name: 'モニター', amount: '50000' },
      { name: 'モニター', amount: '60000' },
    ]);
    await render();
    await waitFor(() => missingItems().length > 0, 1000).catch(() => {});
    expect(missingItems()).toHaveLength(2);
    byTestId('opening-missing-asset-register', missingItems()[0]!)!.click();
    await waitFor(() => container!.querySelector('input[name="missingAssetAcqDate"]') !== null);
    await fillAndSubmit('2026-01-01', '300000', '4');
    byTestId('opening-missing-asset-submit-anyway')?.click();
    await waitFor(async () => (await db.fixedAssets.count()) === 1);
    await waitFor(() => missingItems().length === 1);
  });

  test('申告済みの確認の間に元の仕訳が打ち消されたら登録しない', async () => {
    const id = await seedRestored(2026, '2026-07-01', [{ name: '私用PC', amount: '165540' }]);
    await lockYears(2026);
    await render();
    await waitFor(() => missingItem('私用PC') !== undefined, 1000).catch(() => {});
    expect(missingItem('私用PC')).toBeDefined();
    await openRegister('私用PC');
    await fillAndSubmit('2024-01-01', '300000', '4');
    await waitFor(() => filedYearGuard.pending !== null);
    await reverseEntry(id, { allowedFiledYears: ALL_YEARS });
    await filedYearGuard.resolve(true);
    await settle();
    expect(await db.fixedAssets.count()).toBe(0);
    await waitFor(() => missingItem('私用PC') === undefined);
  });

  test('設定画面で登録した同名・同科目で取得日 2020-01-01 の資産はこの転用資産とみなし、その旨を示す', async () => {
    await seedRestored(2026, '2026-07-01', [{ name: '私用PC', amount: '165540' }]);
    await db.fixedAssets.add({
      id: 'manual',
      name: '私用PC',
      acquisitionDate: '2020-01-01',
      acquisitionCost: '300000',
      usefulLifeYears: 4,
      depreciationMethod: 'straight-line',
      accountCode: '1510',
    });
    await render();
    await waitFor(() => byTestId('opening-missing-assets-assumed') !== null, 1000).catch(() => {});
    expect(byTestId('opening-missing-assets-assumed')).not.toBeNull();
    expect(byTestId('opening-missing-assets-assumed')?.textContent).toContain(
      m.opening_missing_assets_assumed({ name: '私用PC', date: '2020-01-01' }),
    );
    expect(missingItem('私用PC')).toBeUndefined();
  });

  test('取得日 2026-08-01（開業日より後）の同名の資産はこの転用資産とみなさず、登録し直す資産として示す', async () => {
    await seedRestored(2026, '2026-07-01', [{ name: '私用PC', amount: '165540' }]);
    await db.fixedAssets.add({
      id: 'manual',
      name: '私用PC',
      acquisitionDate: '2026-08-01',
      acquisitionCost: '300000',
      usefulLifeYears: 4,
      depreciationMethod: 'straight-line',
      accountCode: '1510',
    });
    await render();
    await waitFor(() => missingItem('私用PC') !== undefined, 1000).catch(() => {});
    expect(missingItem('私用PC')).toBeDefined();
    expect(byTestId('opening-missing-assets-assumed')).toBeNull();
  });

  test('「登録しない」を押した資産は示さない', async () => {
    await seedRestored(2026, '2026-07-01', [{ name: '私用PC', amount: '165540' }]);
    await render();
    await waitFor(() => missingItem('私用PC') !== undefined, 1000).catch(() => {});
    expect(missingItem('私用PC')).toBeDefined();
    byTestId('opening-missing-asset-dismiss', missingItem('私用PC')!)!.click();
    await waitFor(() => missingItem('私用PC') === undefined);
    expect(await getSetting('dismissedMissingOpeningAssets')).toEqual([
      'restored-2026:restored-2026-d0',
    ]);
  });
});

describe('案内の文面とボタン', () => {
  test('案内の文面、「開業仕訳を元に戻す」と「表示しない」のボタン、元に戻す確認の見出しを年つきで示す', async () => {
    await interrupt('2026-07-01');
    await renderAndWaitNotice();
    expect(notice()?.textContent ?? '').toContain(m.opening_interrupted_years({ years: '2026' }));
    expect(byTestId('opening-restore-2026')!.textContent?.trim()).toBe(m.opening_restore_button());
    expect(byTestId('opening-dismiss-2026')!.textContent?.trim()).toBe(
      m.opening_interrupted_dismiss(),
    );
    byTestId('opening-restore-2026')!.click();
    await waitFor(() => bodyButton('opening-restore-confirm-action') !== null);
    expect(document.body.textContent).toContain(m.opening_restore_confirm_title({ year: 2026 }));
  });
});

describe('元に戻した結果の表示', () => {
  test('元に戻せたら「N 本の開業仕訳を元に戻しました。」を示し、新しい仕訳の入力日は今日になる', async () => {
    await interrupt('2026-07-01', '私用PC');
    await renderAndWaitNotice();
    const started = Date.now();
    await clickRestore(2026);
    await waitFor(async () => (await restoredEntries(2026)).length > 0);
    await settle();
    expect(text()).toContain(m.opening_restore_success({ count: 3 }));
    const restored = await restoredEntries(2026);
    expect(restored.every((e) => e.description.startsWith('[再計上] '))).toBe(true);
    expect(restored.every((e) => e.createdAt >= started)).toBe(true);
    expect(await db.fixedAssets.count()).toBe(0);
  });

  test('元に戻しても、後の年の前期繰越の仕訳は自動では直らない', async () => {
    await interrupt('2026-07-01');
    await db.journalEntries.add({
      id: 'carry-2027',
      date: '2027-01-01',
      year: 2027,
      description: '前期繰越',
      status: 'confirmed',
      source: 'carryover',
      createdAt: 1,
      confirmedAt: 1,
    });
    await db.journalLines.add({
      id: 'carry-2027-d',
      entryId: 'carry-2027',
      side: 'debit',
      accountCode: '1110',
      amount: '12345',
      amountIndexed: '00000000012345.00',
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
    });
    const before2027 = JSON.stringify([
      await db.journalEntries.where('year').equals(2027).toArray(),
      await db.journalLines.where('entryId').equals('carry-2027').toArray(),
    ]);
    await renderAndWaitNotice();
    await clickRestore(2026);
    await waitFor(async () => (await restoredEntries(2026)).length > 0);
    await settle();
    const after2027 = JSON.stringify([
      await db.journalEntries.where('year').equals(2027).toArray(),
      await db.journalLines.where('entryId').equals('carry-2027').toArray(),
    ]);
    expect(after2027).toBe(before2027);
  });

  test('確認している間に止まった年でなくなっていたら、何も変えずにその旨を示す', async () => {
    await interrupt('2026-07-01');
    await renderAndWaitNotice();
    byTestId('opening-restore-2026')!.click();
    await waitFor(() => bodyButton('opening-restore-confirm-action') !== null);
    const reversals = (await db.journalEntries.where('year').equals(2026).toArray()).filter(
      (e) => e.originalEntryId !== undefined,
    );
    await db.journalLines
      .where('entryId')
      .anyOf(reversals.map((e) => e.id))
      .delete();
    await db.journalEntries.bulkDelete(reversals.map((e) => e.id));
    const before = await db.journalEntries.count();
    bodyButton('opening-restore-confirm-action')!.click();
    await settle();
    expect(await db.journalEntries.count()).toBe(before);
    expect(text()).toContain(m.opening_restore_not_interrupted());
  });

  test('確認している間に打消しの元の仕訳が開業設定で作ったものでなくなったら、何も変えずに示す', async () => {
    await interrupt('2026-07-01');
    await renderAndWaitNotice();
    byTestId('opening-restore-2026')!.click();
    await waitFor(() => bodyButton('opening-restore-confirm-action') !== null);
    const originals = (await db.journalEntries.where('year').equals(2026).toArray()).filter(
      (e) => e.originalEntryId === undefined,
    );
    for (const e of originals) {
      await db.journalEntries.update(e.id, { source: 'manual' });
    }
    const before = await db.journalEntries.count();
    bodyButton('opening-restore-confirm-action')!.click();
    await settle();
    expect(await db.journalEntries.count()).toBe(before);
    expect(text()).toContain(m.opening_restore_target_invalid());
  });
});

describe('登録し直す転用資産の表示と入力の検査', () => {
  test('各行に名前・年・開業時の未償却残高を示し、開業日も示す', async () => {
    await seedRestored(2026, '2026-07-01', [{ name: '私用PC', amount: '165540' }]);
    await render();
    await waitFor(() => missingItem('私用PC') !== undefined, 1000).catch(() => {});
    const item = missingItem('私用PC')!;
    expect(item.textContent).toContain(
      m.opening_missing_assets_row({ name: '私用PC', year: 2026, amount: formatJPY('165540') }),
    );
    await openRegister('私用PC');
    expect(item.textContent).toContain(
      m.opening_missing_assets_opening_date({ date: '2026-07-01' }),
    );
  });

  test.each([
    ['blue', true],
    ['white', false],
  ] as const)(
    '申告方法が %s のとき、少額減価償却資産の特例のチェックボックスが出る: %s',
    async (filingType, shown) => {
      await setSetting('filingType', filingType);
      await seedRestored(2026, '2026-07-01', [{ name: '私用PC', amount: '165540' }]);
      await render();
      await waitFor(() => missingItem('私用PC') !== undefined, 1000).catch(() => {});
      await openRegister('私用PC');
      expect(
        missingItem('私用PC')!.textContent?.includes(m.opening_small_asset_apply_label()),
      ).toBe(shown);
    },
  );

  test.each([
    [
      '取得価額が 100 兆円以上',
      ['2024-01-01', '100000000000000', '4'],
      () => m.common_amount_too_large(),
    ],
    ['耐用年数が 1', ['2024-01-01', '300000', '1'], () => m.opening_asset_life_unsupported()],
    [
      '取得日が日付として読めない',
      ['2024-02-30', '300000', '4'],
      () => m.fixed_asset_issue_date({ field: m.opening_converted_acq_date_title() }),
    ],
  ])('%s のとき、その理由を示して登録しない', async (_label, [acq, cost, life], message) => {
    await seedRestored(2026, '2026-07-01', [{ name: '私用PC', amount: '165540' }]);
    await render();
    await waitFor(() => missingItem('私用PC') !== undefined, 1000).catch(() => {});
    await openRegister('私用PC');
    await fillAndSubmit(acq!, cost!, life!);
    expect(await db.fixedAssets.count()).toBe(0);
    expect(missingItem('私用PC')!.textContent).toContain(message());
  });

  test('仕訳の金額を読めないとき、登録できない旨を示し、登録の操作を出さない', async () => {
    await seedRestored(2026, '2026-07-01', [{ name: '私用PC', amount: '165540' }]);
    await db.journalLines.toCollection().modify((l) => {
      if (l.side === 'debit') {
        l.amount = 'abc';
      }
    });
    await render();
    await waitFor(() => missingItem('私用PC') !== undefined, 1000).catch(() => {});
    const item = missingItem('私用PC')!;
    expect(item.textContent).toContain(m.opening_missing_assets_basis_unreadable());
    expect(byTestId('opening-missing-asset-register', item)).toBeNull();
    expect(await db.fixedAssets.count()).toBe(0);
  });

  test('確認の間に元の仕訳が打ち消されたら、登録しなかった旨を示す', async () => {
    const id = await seedRestored(2026, '2026-07-01', [{ name: '私用PC', amount: '165540' }]);
    await lockYears(2026);
    await render();
    await waitFor(() => missingItem('私用PC') !== undefined, 1000).catch(() => {});
    await openRegister('私用PC');
    await fillAndSubmit('2024-01-01', '300000', '4');
    await waitFor(() => filedYearGuard.pending !== null);
    await reverseEntry(id, { allowedFiledYears: ALL_YEARS });
    await filedYearGuard.resolve(true);
    await settle();
    expect(text()).toContain(m.opening_missing_assets_not_missing());
  });
});
