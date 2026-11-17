// 貸借対照表の追加科目欄（資産は7件まで）に入りきらない科目があるとき、Reports の
// .xtx 書き出しが例外のまま落ちず、科目名を含む理由を画面に出してファイルを書かないことを見る。

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { setSetting } from '../lib/settings';
import { newId } from '../lib/id';
import { toIndexable } from '../lib/decimal';
import { saveTextFile } from '../lib/save-file';
import type { Account, JournalLine } from '../db/types';
import { m } from '../paraglide/messages';

vi.mock('../lib/save-file', () => ({
  saveTextFile: vi.fn(async () => 'saved' as const),
}));

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

const EXTRA_ASSET_COUNT = 8;
const EXTRA_ASSET_NAMES = Array.from({ length: EXTRA_ASSET_COUNT }, (_, i) => `独自資産${i}`);
const TEST_ACCOUNTS: Account[] = [
  { code: '4110', year: 2026, name: '売上高', category: 'revenue', displayOrder: 110 },
  ...EXTRA_ASSET_NAMES.map((name, i): Account => ({
    code: `19${String(i).padStart(2, '0')}`,
    year: 2026,
    name,
    category: 'asset',
    displayOrder: 1900 + i,
  })),
];

async function addEntryWithExtraAssets(): Promise<void> {
  const entryId = newId();
  const now = Date.now();
  await db.transaction('rw', [db.journalEntries, db.journalLines], async () => {
    await db.journalEntries.add({
      id: entryId,
      date: '2026-05-01',
      year: 2026,
      description: 'テスト売上',
      status: 'confirmed',
      source: 'manual',
      createdAt: now,
      confirmedAt: now,
    });
    const line = (side: 'debit' | 'credit', accountCode: string, amount: string): JournalLine => ({
      id: newId(),
      entryId,
      side,
      accountCode,
      amount,
      amountIndexed: toIndexable(amount),
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
    });
    await db.journalLines.bulkAdd([
      ...TEST_ACCOUNTS.slice(1).map((a) => line('debit', a.code, '1000')),
      line('credit', '4110', String(1000 * EXTRA_ASSET_COUNT)),
    ]);
  });
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  await db.delete();
  await db.open();
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

describe('貸借対照表の追加科目が上限を超えたときの .xtx 書き出し', () => {
  test('理由を科目名つきで表示し、ファイルは書かない', async () => {
    await db.accounts.bulkAdd(TEST_ACCOUNTS);
    await addEntryWithExtraAssets();
    await setSetting('userRiyoshaId', '1234567890123456');
    await setSetting('userFilerName', '青井 太郎');
    await setSetting('userFilerZip', '1800001');
    await setSetting('userFilerAddress', '東京都武蔵野市〇〇1-2-3');
    await setSetting('userZeimushoCode', '01101');
    await setSetting('userZeimushoName', '麹町');
    await setSetting('filingType', 'blue');
    await setSetting('aoiroDeductionKind', 'electronic');

    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });
    const el = container;

    await waitFor(() =>
      Array.from(el.querySelectorAll('button')).some(
        (b) => (b.textContent ?? '').trim() === m.reports_xtx_download(),
      ),
    );
    const button = Array.from(el.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === m.reports_xtx_download(),
    )!;
    button.click();

    await waitFor(() =>
      (el.textContent ?? '').includes(
        m.reports_xtx_bs_extra_overflow({
          list: EXTRA_ASSET_NAMES.join('、'),
          assetMax: 7,
          liabilityEquityMax: 14,
        }),
      ),
    );
    expect(saveTextFile).not.toHaveBeenCalled();
  });
});
