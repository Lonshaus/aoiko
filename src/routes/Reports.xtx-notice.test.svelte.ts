// .xtx の書き出しで出る通知（lockError）は画面の上方に 1 か所だけ出る。
// 画面を開いたあとに読めない明細が増えた場合は、例外にせず明細の一覧を示して書き出さない。

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { setSetting } from '../lib/settings';
import { newId } from '../lib/id';
import { toIndexable } from '../lib/decimal';
import { saveTextFile } from '../lib/save-file';
import { describeFoundAmounts, findOversizedAmounts } from '../domain/oversized-amounts';
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

async function addEntry(
  options: { description?: string; debitCode?: string; creditCode?: string; amount?: string } = {},
): Promise<string> {
  const {
    description = 'テスト売上',
    debitCode = '1110',
    creditCode = '4110',
    amount = '1000',
  } = options;
  const entryId = newId();
  const now = Date.now();
  await db.transaction('rw', [db.journalEntries, db.journalLines], async () => {
    await db.journalEntries.add({
      id: entryId,
      date: '2026-05-01',
      year: 2026,
      description,
      status: 'confirmed',
      source: 'manual',
      createdAt: now,
      confirmedAt: now,
    });
    const line = (side: 'debit' | 'credit', accountCode: string): JournalLine => ({
      id: `${entryId}-${side}`,
      entryId,
      side,
      accountCode,
      amount,
      amountIndexed: toIndexable('1000'),
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
    });
    await db.journalLines.bulkAdd([line('debit', debitCode), line('credit', creditCode)]);
  });
  return entryId;
}

async function setFiler(): Promise<void> {
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

async function mountReports(): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Reports, { target: container, props: {} });
  await waitFor(() => downloadButton(container!) !== undefined);
  return container;
}

function downloadButton(el: HTMLElement): HTMLButtonElement | undefined {
  return Array.from(el.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === m.reports_xtx_download(),
  );
}

function errorBoxes(el: HTMLElement, message: string): Element[] {
  return Array.from(
    el.querySelectorAll('div.border-destructive.text-destructive:not([role="alert"])'),
  ).filter((e) => (e.textContent ?? '').includes(message));
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  const accounts: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year: 2026 }));
  await db.accounts.bulkPut(accounts);
});

afterEach(async () => {
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  container?.remove();
  container = undefined;
  await db.delete();
  vi.clearAllMocks();
});

describe('.xtx 書き出しの通知', () => {
  test('申告者情報の不足は画面に 1 か所だけ、最初のセクションより前に出る', async () => {
    await addEntry();
    const el = await mountReports();
    downloadButton(el)!.click();
    const message = m.reports_xtx_filer_incomplete();
    await waitFor(() => errorBoxes(el, message).length > 0);
    const boxes = errorBoxes(el, message);
    expect(boxes).toHaveLength(1);
    const first = el.querySelector('section')!;
    expect(first.compareDocumentPosition(boxes[0]!) & Node.DOCUMENT_POSITION_PRECEDING).not.toBe(0);
    expect(saveTextFile).not.toHaveBeenCalled();
  });

  test('開いたあとに読めない明細が増えたら、明細の一覧を上方に示して書き出さない', async () => {
    await setFiler();
    await addEntry();
    const el = await mountReports();
    await addEntry({
      description: '読めない経費',
      debitCode: '5200',
      creditCode: '1110',
      amount: 'abc',
    });
    downloadButton(el)!.click();
    const expected = describeFoundAmounts(await findOversizedAmounts({ year: 2026 }));
    expect(expected).toContain('読めない経費');
    await waitFor(() => errorBoxes(el, expected).length > 0);
    expect(errorBoxes(el, expected)).toHaveLength(1);
    expect(el.textContent).not.toContain('DecimalError');
    expect(saveTextFile).not.toHaveBeenCalled();
  });
});
