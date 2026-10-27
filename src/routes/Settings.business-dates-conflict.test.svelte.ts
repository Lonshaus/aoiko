// 設定画面の開業日・廃業日：変えた欄だけを書き、書く前にほかの画面での変更と突き合わせる（H4・H5）。作り直しの途中で止まった年の案内（H6）。
// A 類：修正前に失敗するもの（最初に失敗するのは DB の中身か画面の状態の断言）。B 類：修正前後とも通るもの。
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { getSetting, setSetting } from '../lib/settings';
import { markYearFiled } from '../domain/snapshots';
import { generateOpeningEntries, removeOpeningEntries } from '../domain/business-opening';
import { filedYearGuard } from '../lib/filed-year-guard.svelte';
import { m } from '../paraglide/messages';
import type { ReportSnapshotData } from '../db/types';

const { default: Settings } = await import('./Settings.svelte');

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
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

const MOUNT_SENTINEL = 'ZZZ9';
let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

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

function saveDates(): void {
  [...section().querySelectorAll('button')]
    .find((b) => b.textContent?.trim() === m.settings_action_save())!
    .click();
}

function conflictShown(): boolean {
  return section().querySelector('[data-testid="business-dates-conflict"]') !== null;
}
// 保存の結果（保存済み・食い違い・エラー）のどれかが出るまで待つ
async function waitSaveOutcome(): Promise<void> {
  await waitFor(
    () =>
      sectionText().includes(m.settings_basic_saved()) ||
      conflictShown() ||
      section().querySelector('.text-destructive') !== null,
  );
  await settle();
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
  await waitFor(() => (container!.textContent ?? '').includes(MOUNT_SENTINEL));
  await waitFor(() => field('businessStartDateSetting') !== null);
  await settle();
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

beforeEach(async () => {
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

describe('A 類：変えた欄だけを書き、ほかの画面での変更を上書きしない（H4）', () => {
  test('Q1：ここで廃業日を変え、ほかの画面で開業日が変わったら、保存後の開業日はほかの画面の値', async () => {
    await setSetting('businessStartDate', '2026-01-01');
    await mountSettings();
    type('businessCloseDateSetting', '2026-12-20');
    await setSetting('businessStartDate', '2026-07-01');
    await settle();
    saveDates();
    await waitSaveOutcome();
    expect(await getSetting('businessStartDate')).toBe('2026-07-01');
    expect(await getSetting('businessCloseDate')).toBe('2026-12-20');
  });

  test('変えていない欄は、ほかの画面での変更に追従して表示が変わる', async () => {
    await setSetting('businessStartDate', '2026-01-01');
    await mountSettings();
    type('businessCloseDateSetting', '2026-12-20');
    await setSetting('businessStartDate', '2026-07-01');
    await settle();
    expect(field('businessStartDateSetting').value).toBe('2026-07-01');
    expect(field('businessCloseDateSetting').value).toBe('2026-12-20');
  });

  test('Q2：同じ欄がほかの画面で変わっていたら書かず、食い違いを示して最新の値を出す', async () => {
    await setSetting('businessStartDate', '2026-01-01');
    await mountSettings();
    type('businessStartDateSetting', '2026-03-01');
    await setSetting('businessStartDate', '2026-07-01');
    await settle();
    saveDates();
    await waitSaveOutcome();
    expect(await getSetting('businessStartDate')).toBe('2026-07-01');
    expect(field('businessStartDateSetting').value).toBe('2026-07-01');
    expect(conflictShown()).toBe(true);
    expect(sectionText()).toContain(
      m.settings_business_dates_conflict({ fields: m.settings_business_dates_field_start() }),
    );
  });

  test('申告済みの確認を開いている間に同じ欄がほかの画面で変わったら、続けても書かない', async () => {
    await lockYears(2026);
    await setSetting('businessStartDate', '2026-01-01');
    await mountSettings();
    type('businessStartDateSetting', '2026-03-01');
    saveDates();
    await waitFor(() => filedYearGuard.pending !== null);
    await setSetting('businessStartDate', '2026-07-01');
    await filedYearGuard.resolve(true);
    await waitSaveOutcome();
    expect(await getSetting('businessStartDate')).toBe('2026-07-01');
    expect(conflictShown()).toBe(true);
  });

  test('申告済みの年を数えた後、書く前に変えていない欄がほかの画面で変わったら書かない', async () => {
    await lockYears(2026);
    await setSetting('businessStartDate', '2026-01-01');
    await mountSettings();
    type('businessCloseDateSetting', '2026-12-31');
    saveDates();
    await waitFor(() => filedYearGuard.pending !== null);
    await setSetting('businessStartDate', '2026-05-01');
    await filedYearGuard.resolve(true);
    await waitSaveOutcome();
    expect(await getSetting('businessStartDate')).toBe('2026-05-01');
    expect(await getSetting('businessCloseDate')).toBeUndefined();
    expect(conflictShown()).toBe(true);
  });

  test('最初の入力と同時にほかの画面で書かれても、画面に出ていた値と比べて食い違いを見つける', async () => {
    await setSetting('businessStartDate', '2026-01-01');
    await mountSettings();
    const write = setSetting('businessStartDate', '2026-07-01');
    type('businessStartDateSetting', '2026-03-01');
    await write;
    await settle();
    saveDates();
    await waitSaveOutcome();
    expect(await getSetting('businessStartDate')).toBe('2026-07-01');
    expect(conflictShown()).toBe(true);
  });

  test('両方の欄を変え、片方だけ食い違ったら、どちらも書かず、もう片方の入力は残す', async () => {
    await setSetting('businessStartDate', '2026-01-01');
    await setSetting('businessCloseDate', '2026-12-31');
    await mountSettings();
    type('businessStartDateSetting', '2026-03-01');
    type('businessCloseDateSetting', '2026-11-30');
    await setSetting('businessCloseDate', '2026-10-31');
    await settle();
    saveDates();
    await waitSaveOutcome();
    expect(await getSetting('businessCloseDate')).toBe('2026-10-31');
    expect(await getSetting('businessStartDate')).toBe('2026-01-01');
    expect(field('businessStartDateSetting').value).toBe('2026-03-01');
    expect(field('businessCloseDateSetting').value).toBe('2026-10-31');
    expect(sectionText()).toContain(
      m.settings_business_dates_conflict({ fields: m.settings_business_dates_field_close() }),
    );
  });
});

describe('A 類：2 つの値はまとめて書く（H5）', () => {
  test('Q3：両方の欄を変えて廃業日の書き込みが失敗したら、どちらの値も変わらない', async () => {
    await setSetting('businessStartDate', '2026-01-01');
    await setSetting('businessCloseDate', '2026-12-31');
    await mountSettings();
    type('businessStartDateSetting', '2026-04-01');
    type('businessCloseDateSetting', '2026-11-30');
    const original = db.settings.put.bind(db.settings);
    vi.spyOn(db.settings, 'put').mockImplementation(((
      row: Parameters<typeof original>[0],
      key?: Parameters<typeof original>[1],
    ) =>
      row.key === 'businessCloseDate'
        ? Promise.reject(new Error('廃業日の書き込み失敗（試験）'))
        : original(row, key)) as typeof original);
    saveDates();
    await waitFor(() => sectionText().includes('廃業日の書き込み失敗（試験）'));
    vi.restoreAllMocks();
    expect(await getSetting('businessStartDate')).toBe('2026-01-01');
    expect(await getSetting('businessCloseDate')).toBe('2026-12-31');
  });
});

describe('B 類：開業日・廃業日の保存の回帰', () => {
  test('保存済みの開業日 2026/07/01 が読めなければ、入れずに保存すると消える', async () => {
    await db.settings.put({ key: 'businessStartDate', value: '2026/07/01', updatedAt: 1 });
    await mountSettings();
    expect(field('businessStartDateSetting').value).toBe('');
    saveDates();
    await waitFor(async () => (await getSetting('businessStartDate')) === undefined);
    await settle();
    expect(conflictShown()).toBe(false);
  });

  test('保存済みの廃業日が {} でも、開業日だけ変えて保存すると食い違いにならない', async () => {
    await db.settings.put({ key: 'businessCloseDate', value: {}, updatedAt: 1 });
    await mountSettings();
    type('businessStartDateSetting', '2026-04-01');
    saveDates();
    await waitFor(
      async () => (await getSetting('businessStartDate')) === '2026-04-01' || conflictShown(),
    );
    await settle();
    expect(await getSetting('businessStartDate')).toBe('2026-04-01');
    expect(await getSetting('businessCloseDate')).toBeUndefined();
    expect(conflictShown()).toBe(false);
  });

  test('保存済みの廃業日が空文字列でも、開業日だけ変えて保存すると食い違いにならない', async () => {
    await db.settings.put({ key: 'businessCloseDate', value: '', updatedAt: 1 });
    await mountSettings();
    type('businessStartDateSetting', '2026-04-01');
    saveDates();
    await waitSaveOutcome();
    expect(await getSetting('businessStartDate')).toBe('2026-04-01');
    expect([undefined, '']).toContain(await getSetting('businessCloseDate'));
    expect(conflictShown()).toBe(false);
  });
});

describe('A 類：作り直しの途中で止まった年の案内（H6）', () => {
  test('開業仕訳が打ち消されたまま作り直されていない年を、開業日・廃業日の欄に示す', async () => {
    await generateOpeningEntries({
      businessStartDate: '2026-07-01',
      expenses: [{ name: '名刺', amount: '10000' }],
      expenseAmortization: 'immediate',
      convertedAssets: [],
      customItems: [],
    });
    await removeOpeningEntries(2026);
    await mountSettings();
    await waitFor(
      () => section().querySelector('[data-testid="settings-interrupted-opening-years"]') !== null,
      1000,
    ).catch(() => {});
    const notice = section().querySelector('[data-testid="settings-interrupted-opening-years"]');
    expect(notice?.textContent ?? '').toContain('2026');
    expect(notice?.querySelector('a[href="/opening-setup"]')).not.toBeNull();
  });
});
