// Reports.svelte を表示したまま在庫自動評価の設定を切り替えたとき、
// 期末棚卸高の試算が設定の変更に追従することをマウント済みコンポーネントで見る。
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { setSetting } from '../lib/settings';
import { toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { ledger } from '../stores/ledger.svelte';
import { m } from '../paraglide/messages';
import type { Account } from '../db/types';

vi.mock('../lib/save-file', () => ({
  saveTextFile: vi.fn(async () => 'saved' as const),
}));

const { default: Reports } = await import('./Reports.svelte');

const YEAR = 2026;

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

function sectionShown(): boolean {
  return (container?.textContent ?? '').includes(m.reports_pl_inventory_suggestion_title());
}

function overviewShown(): boolean {
  return (container?.textContent ?? '').includes(m.reports_overview_title({ year: YEAR }));
}

async function seed(enabled: boolean): Promise<void> {
  await db.delete();
  await db.open();
  await db.accounts.bulkPut(ACCOUNTS_2026.map((a) => ({ ...a, year: YEAR }) as Account));
  const itemId = newId();
  await db.inventoryItems.add({ id: itemId, name: '品A' });
  const entryId = newId();
  const now = Date.now();
  await db.journalEntries.add({
    id: entryId,
    date: `${YEAR}-03-10`,
    year: YEAR,
    description: '仕入',
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
      accountCode: side === 'debit' ? '5020' : '1110',
      amount: '10000',
      amountIndexed: toIndexable('10000'),
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
      ...(side === 'debit' ? { itemId, quantity: '10' } : {}),
    })),
  );
  await setSetting('taxRegistration', 'tax-free');
  await setSetting('inventoryAutoValuationEnabled', enabled);
  await setSetting('currentYear', YEAR);
  await waitFor(
    () => ledger.currentYear === YEAR && ledger.inventoryAutoValuationEnabled === enabled,
  );
}

function mountReports(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Reports, { target: container, props: {} });
}

beforeEach(() => {
  container = undefined;
  instance = undefined;
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

describe('Reports 在庫自動評価の設定切替', () => {
  test('設定が有効な状態でマウントすると試算が表示される', async () => {
    await seed(true);
    mountReports();
    await waitFor(sectionShown);
  });

  test('表示中に無効から有効へ切り替えると試算が現れる', async () => {
    await seed(false);
    mountReports();
    // 概況と試算は主クエリの同じ結果で描画されるため、概況が出た時点で試算の有無も確定している
    await waitFor(overviewShown);
    expect(sectionShown()).toBe(false);
    await setSetting('inventoryAutoValuationEnabled', true);
    await waitFor(sectionShown);
  });

  test('表示中に有効から無効へ切り替えると試算が消える', async () => {
    await seed(true);
    mountReports();
    await waitFor(sectionShown);
    await setSetting('inventoryAutoValuationEnabled', false);
    await waitFor(() => !sectionShown());
  });
});
