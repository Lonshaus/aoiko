// 明細集計だけが読み込みに失敗したとき、主クエリの失敗とは別の表示になることを見る。
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { setSetting } from '../lib/settings';
import { toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { ledger } from '../stores/ledger.svelte';
import { m } from '../paraglide/messages';
import { describeStorageError } from '../lib/storage-error';
import type { Account } from '../db/types';

vi.mock('../lib/save-file', () => ({
  saveTextFile: vi.fn(async () => 'saved' as const),
}));

const { default: Reports } = await import('./Reports.svelte');

const YEAR = 2026;
const VENDOR_NAME = '内訳テスト商店';

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function text(): string {
  return container?.textContent ?? '';
}

function buttonByText(label: string): HTMLButtonElement {
  return Array.from(container!.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(label),
  )!;
}

function mountReports(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Reports, { target: container, props: {} });
}

const plTitle = () => m.reports_overview_title({ year: YEAR });
const breakdownErrorText = (failure: Error) =>
  m.reports_breakdown_load_error({ message: describeStorageError(failure) });
const reportsErrorText = (failure: Error) =>
  m.reports_load_error({ message: describeStorageError(failure) });

beforeEach(async () => {
  await db.delete();
  await db.open();
  const accs: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year: YEAR }));
  await db.accounts.bulkPut(accs);
  const vendorId = newId();
  await db.vendors.add({ id: vendorId, name: VENDOR_NAME });
  const entryId = newId();
  const now = Date.now();
  await db.journalEntries.add({
    id: entryId,
    date: `${YEAR}-03-10`,
    year: YEAR,
    description: '売上',
    status: 'confirmed',
    source: 'manual',
    createdAt: now,
    confirmedAt: now,
  });
  await db.journalLines.bulkAdd(
    (['debit', 'credit'] as const).map((side) => ({
      id: newId(),
      entryId,
      side,
      accountCode: side === 'debit' ? '1130' : '4110',
      ...(side === 'credit' ? { vendorId } : {}),
      amount: '110000',
      amountIndexed: toIndexable('110000'),
      taxRate: side === 'credit' ? 0.1 : 0,
      taxIncluded: true,
      invoiceCompliant: false,
    })),
  );
  await setSetting('inventoryAutoValuationEnabled', false);
  await setSetting('currentYear', YEAR);
  await waitFor(
    () => ledger.currentYear === YEAR && ledger.inventoryAutoValuationEnabled === false,
  );
  await sleep(200);
});

afterEach(async () => {
  vi.restoreAllMocks();
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

describe('レポート画面: 明細集計の読み込み失敗', () => {
  test('明細だけ失敗しても他の数字は残り、軸の切替で読み直せる', async () => {
    const failure = new Error('取引先の読み込み失敗');
    const spy = vi
      .spyOn(db.vendors, 'toArray')
      .mockImplementation(() => Promise.reject(failure) as never);

    mountReports();
    await waitFor(() => text().includes(breakdownErrorText(failure)));
    await sleep(200);

    expect(text()).not.toContain(reportsErrorText(failure));
    expect(text()).toContain(plTitle());
    expect(text()).toContain(m.reports_breakdown_title());
    expect(buttonByText(m.reports_breakdown_by_vendor())).toBeDefined();
    expect(buttonByText(m.reports_breakdown_by_subaccount())).toBeDefined();
    expect(buttonByText(m.reports_breakdown_by_department())).toBeDefined();

    spy.mockRestore();
    buttonByText(m.reports_breakdown_by_subaccount()).click();
    await waitFor(() => !text().includes(breakdownErrorText(failure)));
    buttonByText(m.reports_breakdown_by_vendor()).click();
    await waitFor(() => text().includes(VENDOR_NAME));
    await sleep(200);

    expect(text()).not.toContain(breakdownErrorText(failure));
    expect(text()).not.toContain(reportsErrorText(failure));
    expect(text()).toContain(plTitle());
  });

  test('主クエリが失敗したときは読み込みエラーだけを出し、明細は出さない', async () => {
    const failure = new Error('仕訳の読み込み失敗');
    vi.spyOn(db.journalLines, 'where').mockImplementation(() => {
      throw failure;
    });

    mountReports();
    await waitFor(() => text().includes(reportsErrorText(failure)));
    await sleep(300);

    expect(text()).not.toContain(plTitle());
    expect(text()).not.toContain(m.reports_breakdown_title());
    expect(text()).not.toContain(breakdownErrorText(failure));
  });
});
