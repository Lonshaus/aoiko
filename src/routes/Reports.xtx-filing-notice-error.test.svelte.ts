// 届出事項の文字列が上限を超えて buildXtx2026 が投げたとき、Reports はその旨を表示し、
// .xtx を保存しないことを見る。

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { setSetting } from '../lib/settings';
import { newId } from '../lib/id';
import { toIndexable } from '../lib/decimal';
import { saveTextFile } from '../lib/save-file';
import type { Account, JournalLine } from '../db/types';
import { XtxFilingNoticeTextTooLongError } from '../tax-schema/2026/xtx-filing-notices';
import { m } from '../paraglide/messages';

vi.mock('../lib/save-file', () => ({
  saveTextFile: vi.fn(async () => 'saved' as const),
}));

vi.mock('../tax-schema/2026/xtx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tax-schema/2026/xtx')>();
  return {
    ...actual,
    buildXtx2026: () => {
      throw new XtxFilingNoticeTextTooLongError('AMM00090', 40);
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

const TEST_ACCOUNTS: Account[] = [
  { code: '1130', year: 2026, name: '普通預金', category: 'asset', displayOrder: 130 },
  { code: '4110', year: 2026, name: '売上高', category: 'revenue', displayOrder: 110 },
];

async function addEntry(): Promise<void> {
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
    const line = (side: 'debit' | 'credit', accountCode: string): JournalLine => ({
      id: newId(),
      entryId,
      side,
      accountCode,
      amount: '2000000',
      amountIndexed: toIndexable('2000000'),
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
    });
    await db.journalLines.bulkAdd([line('debit', '1130'), line('credit', '4110')]);
  });
}

async function setUpFiler(): Promise<void> {
  await setSetting('userRiyoshaId', '1234567890123456');
  await setSetting('userFilerName', '青井 太郎');
  await setSetting('userFilerZip', '1800001');
  await setSetting('userFilerAddress', '東京都武蔵野市〇〇1-2-3');
  await setSetting('userZeimushoCode', '01101');
  await setSetting('userZeimushoName', '麹町');
  await setSetting('filingType', 'blue');
  await setSetting('aoiroDeductionKind', 'electronic');
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

async function mountAndClickDownload(): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Reports, { target: container, props: {} });
  const el = container;
  const isDownloadButton = (b: HTMLButtonElement) =>
    (b.textContent ?? '').trim() === m.reports_xtx_download();
  await waitFor(() => Array.from(el.querySelectorAll('button')).some(isDownloadButton));
  Array.from(el.querySelectorAll('button')).find(isDownloadButton)!.click();
  return el;
}

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

describe('届出事項の文字数が上限を超えたときの .xtx 書き出し', () => {
  test('エラーメッセージを表示し、ファイルを保存しない', async () => {
    await db.accounts.bulkAdd(TEST_ACCOUNTS);
    await addEntry();
    await setUpFiler();

    const el = await mountAndClickDownload();
    const expected = m.reports_xtx_filing_notice_too_long({ tag: 'AMM00090', max: 40 });
    await waitFor(() => (el.textContent ?? '').includes(expected));

    expect(saveTextFile).not.toHaveBeenCalled();
  });
});
