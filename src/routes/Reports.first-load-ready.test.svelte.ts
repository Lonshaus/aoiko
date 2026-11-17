import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { setSetting, type StoredWariBaseAdjustments } from '../lib/settings';
import { ledger } from '../stores/ledger.svelte';
import { m } from '../paraglide/messages';
import type { Account } from '../db/types';

vi.mock('../lib/save-file', () => ({
  saveTextFile: vi.fn(async () => 'saved' as const),
}));

type Hold = { wait: Promise<void>; error: Error | undefined };
const gate = vi.hoisted(() => ({
  wari: undefined as Hold | undefined,
  months: undefined as Hold | undefined,
}));

vi.mock('../lib/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/settings')>();
  return {
    ...actual,
    loadWariStoredAmounts: async (year: number) => {
      const hold = gate.wari;
      if (hold !== undefined) {
        await hold.wait;
        if (hold.error !== undefined) {
          throw hold.error;
        }
      }
      return actual.loadWariStoredAmounts(year);
    },
    loadInterimPriorPeriodMonths: async (year: number) => {
      const hold = gate.months;
      if (hold !== undefined) {
        await hold.wait;
        if (hold.error !== undefined) {
          throw hold.error;
        }
      }
      return actual.loadInterimPriorPeriodMonths(year);
    },
  };
});

const { default: Reports } = await import('./Reports.svelte');

function hold(error?: Error): { hold: Hold; release: () => void } {
  let release = (): void => {};
  const wait = new Promise<void>((r) => {
    release = r;
  });
  return { hold: { wait, error }, release: () => release() };
}

type RejectionListener = (reason: unknown) => void;
const nodeProcess = (
  globalThis as unknown as {
    process: {
      listeners(event: string): RejectionListener[];
      removeAllListeners(event: string): void;
      on(event: string, listener: RejectionListener): void;
      off(event: string, listener: RejectionListener): void;
    };
  }
).process;
const onRejection: RejectionListener = () => {};
let runnerListeners: RejectionListener[] = [];

const SEED: StoredWariBaseAdjustments = {
  salesReturnTax78: '20',
  salesReturnTax624: '30',
  specifiedSmallAssetTransfers: [{ date: '2026-02-01', rate: 0.1, netTax: '100' }],
};

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  gate.wari = undefined;
  gate.months = undefined;
  runnerListeners = nodeProcess.listeners('unhandledRejection');
  nodeProcess.removeAllListeners('unhandledRejection');
  nodeProcess.on('unhandledRejection', onRejection);
  await db.delete();
  await db.open();
  const accs: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year: 2026 }));
  await db.accounts.bulkPut(accs);
  await setSetting('currentYear', 2026);
  await waitFor(() => ledger.currentYear === 2026);
  await setSetting('wariBaseAdjustments', { 2026: SEED });
  await setSetting('interimPriorPeriodMonths', { 2026: 4 });
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
  nodeProcess.off('unhandledRejection', onRejection);
  for (const listener of runnerListeners) {
    nodeProcess.on('unhandledRejection', listener);
  }
  await db.delete();
  vi.clearAllMocks();
});

function named(name: string): HTMLInputElement {
  const el = container!.querySelector<HTMLInputElement>(`[name="${name}"]`);
  if (el === null) {
    throw new Error(`${name} not found`);
  }
  return el;
}

function addButton(): HTMLButtonElement {
  const hint = Array.from(container!.querySelectorAll('p')).find(
    (p) => (p.textContent ?? '').trim() === m.reports_wari_specified_small_asset_transfers_hint(),
  );
  const el = Array.from(hint?.parentElement?.querySelectorAll('button') ?? []).find(
    (b) => (b.textContent ?? '').trim() === m.settings_action_add(),
  );
  if (el === undefined) {
    throw new Error('add button not found');
  }
  return el;
}

function commit(name: string, value: string): void {
  const el = named(name);
  el.dispatchEvent(new FocusEvent('focus'));
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

async function mountAndShowFields(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Reports, { target: container, props: {} });
  flushSync();
  await waitFor(
    () =>
      container!.querySelector('input[name="wariSalesReturnTax78"]') !== null &&
      container!.querySelector('input[name="interimPriorPeriodMonths"]') !== null,
  );
}

function wariFieldsDisabled(): boolean[] {
  return [
    named('wariSalesReturnTax78').disabled,
    named('wariSalesReturnTax624').disabled,
    addButton().disabled,
  ];
}

describe('最初の読込が済むまで、2割／3割特例の欄と月数の欄は入力できない', () => {
  test('2割／3割特例の読込が遅れている間は、返還等の2欄と追加ボタンが無効', async () => {
    const wari = hold();
    gate.wari = wari.hold;
    await mountAndShowFields();
    await settle();
    expect(wariFieldsDisabled()).toEqual([true, true, true]);
    wari.release();
    await waitFor(() => named('wariSalesReturnTax78').value === '20');
  });

  test('月数の読込が遅れている間は、月数の欄が無効', async () => {
    const months = hold();
    gate.months = months.hold;
    await mountAndShowFields();
    await settle();
    expect(named('interimPriorPeriodMonths').disabled).toBe(true);
    months.release();
    await waitFor(() => named('interimPriorPeriodMonths').value === '4');
  });

  test('読込が終わると、すべての欄が入力できる', async () => {
    const wari = hold();
    const months = hold();
    gate.wari = wari.hold;
    gate.months = months.hold;
    await mountAndShowFields();
    await settle();
    wari.release();
    months.release();
    await waitFor(
      () =>
        named('wariSalesReturnTax78').value === '20' &&
        named('interimPriorPeriodMonths').value === '4',
    );
    expect(wariFieldsDisabled()).toEqual([false, false, false]);
    expect(named('interimPriorPeriodMonths').disabled).toBe(false);
  });

  test('2割／3割特例の最初の読込が失敗したら、欄は無効のまま', async () => {
    const wari = hold(new Error('wari-load-failed'));
    gate.wari = wari.hold;
    await mountAndShowFields();
    wari.release();
    await settle();
    expect(wariFieldsDisabled()).toEqual([true, true, true]);
  });

  test('月数の最初の読込が失敗したら、月数の欄は無効のまま', async () => {
    const months = hold(new Error('months-load-failed'));
    gate.months = months.hold;
    await mountAndShowFields();
    months.release();
    await settle();
    expect(named('interimPriorPeriodMonths').disabled).toBe(true);
  });

  test('最初の読込が失敗したあとに入力の確定を試みても、設定は変わらない', async () => {
    const wari = hold(new Error('wari-load-failed'));
    const months = hold(new Error('months-load-failed'));
    gate.wari = wari.hold;
    gate.months = months.hold;
    await mountAndShowFields();
    wari.release();
    months.release();
    await settle();
    commit('wariSalesReturnTax78', '99');
    commit('wariSalesReturnTax624', '98');
    commit('interimPriorPeriodMonths', '7');
    await settle();
    expect((await db.settings.get('wariBaseAdjustments'))?.value).toEqual({ 2026: SEED });
    expect((await db.settings.get('interimPriorPeriodMonths'))?.value).toEqual({ 2026: 4 });
  });
});
