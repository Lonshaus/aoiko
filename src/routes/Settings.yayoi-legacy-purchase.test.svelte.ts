import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { toIndexable } from '../lib/decimal';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { m } from '../paraglide/messages';

const { saveFile } = vi.hoisted(() => ({
  saveFile: vi.fn(async () => 'unknown' as const),
}));
vi.mock('../lib/save-file', () => ({ saveFile }));

const { default: Settings } = await import('./Settings.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}
// onMount の読み込みが終わるまで待つための目印。最後に読む設定に入れる。
const MOUNT_SENTINEL = 'ZZZ9';

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

async function mountSettings(): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Settings, { target: container, props: {} });
  await waitFor(() => (container!.textContent ?? '').includes(MOUNT_SENTINEL));
  return container;
}

function clickYayoi(c: HTMLElement): void {
  const button = [...c.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === m.settings_accountant_export_yayoi(),
  );
  expect(button).toBeDefined();
  button!.click();
  flushSync();
}

beforeEach(async () => {
  saveFile.mockClear();
  await db.delete();
  await db.open();
  await db.accounts.bulkAdd(ACCOUNTS_2026);
  await db.settings.bulkPut([
    { key: 'currentYear', value: 2026, updatedAt: Date.now() },
    { key: 'homeOfficeAccountRatios', value: { [MOUNT_SENTINEL]: '0.30' }, updatedAt: Date.now() },
  ]);
});

afterEach(async () => {
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  container?.remove();
  container = undefined;
  await db.delete();
});

describe('弥生形式 CSV の書き出し後の注意', { timeout: 30_000 }, () => {
  test('申告時の仕入判定で出した年分は、その理由を示す', async () => {
    await db.journalEntries.add({
      id: 'e1',
      date: '2026-04-01',
      year: 2026,
      description: '普通預金への入金',
      status: 'confirmed',
      source: 'manual',
      createdAt: 0,
      confirmedAt: 0,
    });
    const base = {
      entryId: 'e1',
      amount: '22000',
      amountIndexed: toIndexable('22000'),
      taxIncluded: true,
      invoiceCompliant: false,
    };
    await db.journalLines.bulkAdd([
      { ...base, id: 'd', side: 'debit', accountCode: '1130', taxRate: 0.1 },
      { ...base, id: 'c', side: 'credit', accountCode: '3120', taxRate: 0 },
    ]);
    await db.reportSnapshots.add({
      id: 'pl',
      year: 2026,
      type: 'pl',
      status: 'filed',
      filedAt: 1,
      payload: {
        type: 'pl',
        data: { rows: [], totalRevenue: '0', totalExpense: '0', netIncome: '0' },
      },
      generatedAt: 1,
      generatedFromEntriesUpTo: '2026-12-31',
    });
    const c = await mountSettings();

    clickYayoi(c);
    await waitFor(() => c.querySelector('[data-testid="yayoi-export-notices"]') !== null);
    expect(saveFile).toHaveBeenCalledTimes(1);
    const notices = c.querySelector('[data-testid="yayoi-export-notices"]')!;
    expect(notices.textContent).toContain('普通預金への入金');
    expect(notices.textContent).toContain(
      m.settings_accountant_export_yayoi_reason_legacy_purchase(),
    );
  });
});
