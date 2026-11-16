import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { setSetting } from '../lib/settings';
import { ledger } from '../stores/ledger.svelte';
import { m } from '../paraglide/messages';
import type { Account } from '../db/types';

const flag = vi.hoisted(() => ({ on: false }));
vi.mock('../lib/tax-reform-2027-ui', () => ({
  get TAX_REFORM_2027_UI() {
    return flag.on;
  },
}));
vi.mock('../lib/save-file', () => ({
  saveTextFile: vi.fn(async () => 'saved' as const),
}));

const { default: Reports } = await import('./Reports.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
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
  flag.on = false;
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
});

async function mountLoaded(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Reports, { target: container, props: {} });
  flushSync();
  await waitFor(() => container!.querySelector('[name="wariSalesReturnTax78"]') !== null);
  await settle();
}

function hasTransferTitle(): boolean {
  return Array.from(container!.querySelectorAll('p')).some(
    (p) => (p.textContent ?? '').trim() === m.reports_wari_specified_small_asset_transfers(),
  );
}

function hasAddButton(): boolean {
  const hint = Array.from(container!.querySelectorAll('p')).find(
    (p) => (p.textContent ?? '').trim() === m.reports_wari_specified_small_asset_transfers_hint(),
  );
  return Array.from(hint?.parentElement?.querySelectorAll('button') ?? []).some(
    (b) => (b.textContent ?? '').trim() === m.settings_action_add(),
  );
}

describe('特定少額資産の譲渡の入力列は令和9年分以後の画面が出るまで隠す', () => {
  test('保存された列がなければ、標題も追加ボタンも出ず、返還等の欄は残る', async () => {
    await mountLoaded();
    expect(hasTransferTitle()).toBe(false);
    expect(hasAddButton()).toBe(false);
    expect(container!.querySelector('[name="wariSalesReturnTax78"]')).not.toBeNull();
  });

  test('保存された列が1行あれば、その行が出る', async () => {
    await setSetting('wariBaseAdjustments', {
      2026: {
        specifiedSmallAssetTransfers: [{ date: '2026-02-01', rate: 0.1, netTax: '100' }],
      },
    });
    await mountLoaded();
    expect(hasTransferTitle()).toBe(true);
    expect(container!.querySelector('[name="wariTransfer-netTax-0"]')).not.toBeNull();
  });

  test('定数が true なら、保存された列がなくても出る', async () => {
    flag.on = true;
    await mountLoaded();
    expect(hasTransferTitle()).toBe(true);
    expect(hasAddButton()).toBe(true);
  });
});
