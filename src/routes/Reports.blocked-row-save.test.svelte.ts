import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { setSetting } from '../lib/settings';
import { ledger } from '../stores/ledger.svelte';
import { m } from '../paraglide/messages';
import type { Account } from '../db/types';

vi.mock('../lib/save-file', () => ({
  saveTextFile: vi.fn(async () => 'saved' as const),
}));

const { default: Reports } = await import('./Reports.svelte');

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
  await db.delete();
  await db.open();
  const accs: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year: 2026 }));
  await db.accounts.bulkPut(accs);
  await setSetting('currentYear', 2026);
  await waitFor(() => ledger.currentYear === 2026);
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

function named(name: string): HTMLInputElement {
  const el = container!.querySelector<HTMLInputElement>(`[name="${name}"]`);
  if (el === null) {
    throw new Error(`${name} not found`);
  }
  return el;
}

function typeOnly(name: string, value: string): void {
  const el = named(name);
  el.dispatchEvent(new FocusEvent('focus'));
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function commit(name: string, value: string): void {
  typeOnly(name, value);
  named(name).dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
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

async function seed(value: unknown): Promise<void> {
  await setSetting('wariBaseAdjustments', { 2026: value } as never);
}

async function mountLoaded(waitName: string): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Reports, { target: container, props: {} });
  flushSync();
  await waitFor(() => container!.querySelector(`[name="${waitName}"]`) !== null);
  await settle();
}

async function stored(): Promise<unknown> {
  const row = await db.settings.get('wariBaseAdjustments');
  return (row?.value as Record<number, unknown> | undefined)?.[2026];
}

const DATE = 'wariTransfer-date-0';
const NEW_DATE = '2026-03-01';

describe('税額が読めない行でも、日付と税率は保存され、税額は保存済みの値のまま', () => {
  test('保存済みの税額が abc：日付を変えると日付だけ変わる', async () => {
    await seed({
      specifiedSmallAssetTransfers: [{ date: '2026-02-01', rate: 0.1, netTax: 'abc' }],
    });
    await mountLoaded(DATE);
    commit(DATE, NEW_DATE);
    await settle();
    expect(await stored()).toEqual({
      specifiedSmallAssetTransfers: [{ date: NEW_DATE, rate: 0.1, netTax: 'abc' }],
    });
  });

  test('保存済みの税額が abc：税率を変えると税率だけ変わる', async () => {
    await seed({
      specifiedSmallAssetTransfers: [{ date: '2026-02-01', rate: 0.1, netTax: 'abc' }],
    });
    await mountLoaded(DATE);
    const rate = container!.querySelector<HTMLSelectElement>('select[name="wariTransfer-rate-0"]')!;
    const option = Array.from(rate.options).find((o) => o.value === '0.08')!;
    option.selected = true;
    // happy-dom は option の :checked を判定できず、bind:value が選択中の項目を読めないため、読み取りだけ差し替える
    const query = rate.querySelector.bind(rate);
    rate.querySelector = ((selector: string) =>
      selector === ':checked' ? option : query(selector)) as typeof rate.querySelector;
    rate.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    await settle();
    expect(await stored()).toEqual({
      specifiedSmallAssetTransfers: [{ date: '2026-02-01', rate: 0.08, netTax: 'abc' }],
    });
  });

  test('保存済みの税額が数値 5000：日付を変えると日付だけ変わり、税額は数値のまま', async () => {
    await seed({ specifiedSmallAssetTransfers: [{ date: '2026-02-01', rate: 0.1, netTax: 5000 }] });
    await mountLoaded(DATE);
    commit(DATE, NEW_DATE);
    await settle();
    expect(await stored()).toEqual({
      specifiedSmallAssetTransfers: [{ date: NEW_DATE, rate: 0.1, netTax: 5000 }],
    });
  });

  test('保存済みの税額は有効で、欄に 1e3 を入れた状態で日付を変えると、税額は保存済みの値のまま', async () => {
    await seed({
      specifiedSmallAssetTransfers: [{ date: '2026-02-01', rate: 0.1, netTax: '100' }],
    });
    await mountLoaded(DATE);
    typeOnly('wariTransfer-netTax-0', '1e3');
    commit(DATE, NEW_DATE);
    await settle();
    expect(await stored()).toEqual({
      specifiedSmallAssetTransfers: [{ date: NEW_DATE, rate: 0.1, netTax: '100' }],
    });
  });

  test('隠れた行があっても、読めない行の日付だけが変わり、隠れた行とほかの行は変わらない', async () => {
    const hidden = { date: '', rate: 0.1, netTax: '111' };
    const other = { date: '2026-04-01', rate: 0.08, netTax: '200' };
    await seed({
      specifiedSmallAssetTransfers: [
        hidden,
        { date: '2026-02-01', rate: 0.1, netTax: 'abc' },
        other,
      ],
    });
    await mountLoaded(DATE);
    commit(DATE, NEW_DATE);
    await settle();
    expect(await stored()).toEqual({
      specifiedSmallAssetTransfers: [hidden, { date: NEW_DATE, rate: 0.1, netTax: 'abc' }, other],
    });
  });

  test('保存済みの行が読み込み後に表でない値へ上書きされたら、日付を変えても上書きされた値のまま', async () => {
    await seed({
      specifiedSmallAssetTransfers: [{ date: '2026-02-01', rate: 0.1, netTax: '100' }],
    });
    await mountLoaded(DATE);
    typeOnly('wariTransfer-netTax-0', 'abc');
    await seed({ specifiedSmallAssetTransfers: ['junk'] });
    commit(DATE, NEW_DATE);
    await settle();
    expect(await stored()).toEqual({ specifiedSmallAssetTransfers: ['junk'] });
  });

  test('追加した行の税額が不正なら、日付を変えても保存されない', async () => {
    await seed({ salesReturnTax78: '20' });
    await mountLoaded('wariSalesReturnTax78');
    addButton().click();
    flushSync();
    await waitFor(() => container!.querySelector(`[name="${DATE}"]`) !== null);
    typeOnly('wariTransfer-netTax-0', 'abc');
    commit(DATE, NEW_DATE);
    await settle();
    expect(await stored()).toEqual({ salesReturnTax78: '20' });
  });
});
