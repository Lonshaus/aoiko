// 所得税 .xtx は令和8年分までしか出せない。令和9年分では書き出しを行わず、
// 未対応の理由を画面に出してファイルを書かないことを見る（buildXtx2026 の年分防護の手前の判断）。

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { setSetting } from '../lib/settings';
import { newId } from '../lib/id';
import { toIndexable } from '../lib/decimal';
import { saveTextFile } from '../lib/save-file';
import { ledger } from '../stores/ledger.svelte';
import { m } from '../paraglide/messages';
import type { Account, JournalLine } from '../db/types';

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

async function addEntry(): Promise<void> {
  const entryId = newId();
  const now = Date.now();
  await db.transaction('rw', [db.journalEntries, db.journalLines], async () => {
    await db.journalEntries.add({
      id: entryId,
      date: '2027-05-01',
      year: 2027,
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
      amount: '1000',
      amountIndexed: toIndexable('1000'),
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
    });
    await db.journalLines.bulkAdd([line('debit', '1110'), line('credit', '4110')]);
  });
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  await db.delete();
  await db.open();
  const accounts: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year: 2027 }));
  await db.accounts.bulkPut(accounts);
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

async function setFiler(): Promise<void> {
  await setSetting('userRiyoshaId', '1234567890123456');
  await setSetting('userFilerName', '青井 太郎');
  await setSetting('userFilerZip', '1800001');
  await setSetting('userFilerAddress', '東京都武蔵野市〇〇1-2-3');
  await setSetting('userZeimushoCode', '01101');
  await setSetting('userZeimushoName', '麹町');
}

async function mountAndDownload(): Promise<HTMLElement> {
  await setSetting('currentYear', 2027);
  await waitFor(() => ledger.currentYear === 2027);

  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Reports, { target: container, props: {} });
  const el = container;

  const downloadButton = (): HTMLButtonElement | undefined =>
    Array.from(el.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === m.reports_xtx_download(),
    );
  await waitFor(() => downloadButton() !== undefined);
  downloadButton()!.click();
  return el;
}
// lockError はページ上部と出力欄の 2 か所に同じ文言で出るため重複を除く
const errorTexts = (el: HTMLElement): string[] => [
  ...new Set(
    Array.from(el.querySelectorAll('.border-destructive')).map((e) => (e.textContent ?? '').trim()),
  ),
];

describe('令和9年分の所得税 .xtx 書き出し', () => {
  test('未対応の年分として理由を表示し、ファイルは書かない', async () => {
    await addEntry();
    await setFiler();
    const el = await mountAndDownload();

    await waitFor(() =>
      (el.textContent ?? '').includes(m.reports_xtx_unsupported_year({ year: 2027 })),
    );
    expect(errorTexts(el)).toEqual([m.reports_xtx_unsupported_year({ year: 2027 })]);
    expect(saveTextFile).not.toHaveBeenCalled();
  });

  test('申告者情報が未入力でも、年分の未対応を先に伝える', async () => {
    await addEntry();
    const el = await mountAndDownload();

    await waitFor(() => errorTexts(el).length > 0);
    expect(errorTexts(el)).toEqual([m.reports_xtx_unsupported_year({ year: 2027 })]);
    expect(errorTexts(el)).not.toContain(m.reports_xtx_filer_incomplete());
    expect(saveTextFile).not.toHaveBeenCalled();
  });
});
