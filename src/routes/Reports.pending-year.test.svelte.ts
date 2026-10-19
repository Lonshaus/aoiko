import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { getSetting, setSetting } from '../lib/settings';
import { hasUnsavedChanges } from '../router.svelte';
import { ledger } from '../stores/ledger.svelte';
import { m } from '../paraglide/messages';
import type { Account } from '../db/types';

vi.mock('../lib/save-file', () => ({
  saveTextFile: vi.fn(async () => 'saved' as const),
}));
const monthsGate = vi.hoisted(() => ({ wait: Promise.resolve() }));

vi.mock('../lib/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/settings')>();
  return {
    ...actual,
    loadInterimPriorPeriodMonths: async (year: number) => {
      await monthsGate.wait;
      return actual.loadInterimPriorPeriodMonths(year);
    },
  };
});

const { default: Reports } = await import('./Reports.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  await db.delete();
  await db.open();
  for (const year of [2026, 2027, 2028]) {
    const accs: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year }));
    await db.accounts.bulkPut(accs);
  }
  monthsGate.wait = Promise.resolve();
  await setSetting('interimPriorPeriodMonths', { 2027: 6, 2028: 9 });
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
  await db.delete();
  vi.clearAllMocks();
});

async function startAt(year: number): Promise<void> {
  await setSetting('currentYear', year);
  await waitFor(() => ledger.currentYear === year);
}

function mountNow(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Reports, { target: container, props: {} });
  flushSync();
}

function named(name: string): HTMLInputElement {
  const el = container!.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (el === null) {
    throw new Error(`input ${name} not found`);
  }
  return el;
}

async function mountAt(year: number, months: string): Promise<HTMLInputElement> {
  await startAt(year);
  mountNow();
  await waitFor(() => container!.querySelector('input[name="interimPriorPeriodMonths"]') !== null);
  await waitFor(() => named('interimPriorPeriodMonths').value === months);
  return named('interimPriorPeriodMonths');
}

function input(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function commit(el: HTMLInputElement, value: string): void {
  el.dispatchEvent(new FocusEvent('focus'));
  input(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

function typeYear(year: number): void {
  input(named('reportNen'), String(year));
}

function monthsMessageShown(): boolean {
  return (container!.textContent ?? '').includes(m.reports_interim_prior_period_months_invalid());
}

async function expectSwitchedTo(months: string): Promise<void> {
  await waitFor(() => named('interimPriorPeriodMonths').value === months);
  await new Promise((r) => setTimeout(r, 50));
  expect(named('interimPriorPeriodMonths').value).toBe(months);
  expect(monthsMessageShown()).toBe(false);
  expect(hasUnsavedChanges()).toBe(false);
}

describe('読めない月数を残したまま年度を切り替える', () => {
  test('年の欄で切り替えると、新しい年分の月数が表示され未保存の確認は残らない', async () => {
    const months = await mountAt(2027, '6');
    commit(months, '13');
    expect(hasUnsavedChanges()).toBe(true);
    typeYear(2028);
    await expectSwitchedTo('9');
    expect((await getSetting('interimPriorPeriodMonths'))?.[2027]).toBe(6);
  });

  test('別のタブなどで設定の処理年度が変わると、新しい年分の月数が表示され未保存の確認は残らない', async () => {
    const months = await mountAt(2027, '6');
    commit(months, '13');
    expect(hasUnsavedChanges()).toBe(true);
    await setSetting('currentYear', 2028);
    await expectSwitchedTo('9');
  });

  test('switchYear で切り替えると、新しい年分の月数が表示され未保存の確認は残らない', async () => {
    const months = await mountAt(2027, '6');
    commit(months, '13');
    expect(hasUnsavedChanges()).toBe(true);
    ledger.switchYear(2028);
    await expectSwitchedTo('9');
  });

  test('switchYear で別の年分へ移りすぐ戻すと、元の年分の保存値が表示され未保存の確認は残らない', async () => {
    const months = await mountAt(2027, '6');
    commit(months, '13');
    ledger.switchYear(2028);
    flushSync();
    ledger.switchYear(2027);
    flushSync();
    await expectSwitchedTo('6');
  });

  test('年の欄で別の年分へ移りすぐ戻すと、元の年分の保存値が表示され未保存の確認は残らない', async () => {
    const months = await mountAt(2027, '6');
    commit(months, '13');
    typeYear(2028);
    typeYear(2027);
    await expectSwitchedTo('6');
  });

  test('同じ年を入力し直しても年分は変わらず、未保存の確認は残る', async () => {
    const months = await mountAt(2027, '6');
    commit(months, '13');
    typeYear(2027);
    await new Promise((r) => setTimeout(r, 50));
    expect(named('interimPriorPeriodMonths').value).toBe('13');
    expect(monthsMessageShown()).toBe(true);
    expect(hasUnsavedChanges()).toBe(true);
  });

  test('欄にフォーカスしたまま年度が変わると、前の年分の文字列とは比べずに未保存を判定する', async () => {
    const months = await mountAt(2027, '6');
    months.dispatchEvent(new FocusEvent('focus'));
    await setSetting('currentYear', 2028);
    await expectSwitchedTo('9');
    input(months, '6');
    expect(hasUnsavedChanges()).toBe(true);
    months.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(hasUnsavedChanges()).toBe(false);
    let saved = await getSetting('interimPriorPeriodMonths');
    for (let i = 0; i < 200 && saved?.[2028] !== 6; i++) {
      await new Promise((r) => setTimeout(r, 10));
      saved = await getSetting('interimPriorPeriodMonths');
    }
    expect(saved).toEqual({ 2027: 6, 2028: 6 });
  });
});

describe('年分の読込で置き換わる欄の印', () => {
  test('最初の読込より前に入力した月数は読込値に置き換わり、未保存の確認は残らない', async () => {
    let release = (): void => {};
    monthsGate.wait = new Promise((r) => {
      release = r;
    });
    await startAt(2027);
    mountNow();
    await waitFor(
      () => container!.querySelector('input[name="interimPriorPeriodMonths"]') !== null,
    );
    input(named('interimPriorPeriodMonths'), '13');
    expect(hasUnsavedChanges()).toBe(true);
    release();
    await expectSwitchedTo('6');
  });

  test('読めない2割特例の金額を残したまま年度を切り替えると、未保存の確認は残らない', async () => {
    await startAt(2026);
    mountNow();
    await waitFor(() => container!.querySelector('input[name="wariSalesReturnTax78"]') !== null);
    commit(named('wariSalesReturnTax78'), '-5000');
    expect(hasUnsavedChanges()).toBe(true);
    await setSetting('currentYear', 2027);
    await waitFor(() => named('interimPriorPeriodMonths').value === '6');
    await new Promise((r) => setTimeout(r, 50));
    expect(hasUnsavedChanges()).toBe(false);
  });
});

describe('フォーカスしたまま年度が変わった欄の比較', () => {
  test('新しい年分の保存値に打ち戻すと未保存の確認は消え、前の年分の値を打つと残る', async () => {
    const months = await mountAt(2027, '6');
    months.dispatchEvent(new FocusEvent('focus'));
    await setSetting('currentYear', 2028);
    await expectSwitchedTo('9');
    input(months, '91');
    expect(hasUnsavedChanges()).toBe(true);
    input(months, '9');
    expect(hasUnsavedChanges()).toBe(false);
    input(months, '6');
    expect(hasUnsavedChanges()).toBe(true);
  });
});
