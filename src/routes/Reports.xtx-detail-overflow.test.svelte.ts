// 明細欄（減価償却など）の行数が様式の上限を超えたとき、Reports の .xtx 書き出しが
// 追加科目欄の提示と並べて、出せなかった行の提示を表示することを見る。

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { setSetting } from '../lib/settings';
import { newId } from '../lib/id';
import { toIndexable } from '../lib/decimal';
import { saveTextFile } from '../lib/save-file';
import type { Account, FixedAsset, JournalLine } from '../db/types';
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

const EXTRA_EXPENSE_COUNT = 7;
const EXTRA_EXPENSE_ACCOUNTS: Account[] = Array.from(
  { length: EXTRA_EXPENSE_COUNT },
  (_, i): Account => ({
    code: `69${String(i).padStart(2, '0')}`,
    year: 2026,
    name: `独自経費${i}`,
    category: 'expense',
    displayOrder: 6900 + i,
  }),
);
const TEST_ACCOUNTS: Account[] = [
  { code: '4110', year: 2026, name: '売上高', category: 'revenue', displayOrder: 110 },
  ...EXTRA_EXPENSE_ACCOUNTS,
];

function businessAssets(count: number): FixedAsset[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `asset${i}`,
    name: `資産${String(i).padStart(2, '0')}`,
    acquisitionDate: `2020-${String(i + 1).padStart(2, '0')}-01`,
    acquisitionCost: '300000',
    usefulLifeYears: 10,
    depreciationMethod: 'straight-line',
    accountCode: '1510',
  }));
}

async function addEntryWithExtraExpenses(): Promise<void> {
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
      ...EXTRA_EXPENSE_ACCOUNTS.map((a) => line('debit', a.code, '1000')),
      line('credit', '4110', String(1000 * EXTRA_EXPENSE_COUNT)),
    ]);
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

async function mountAndDownload(): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Reports, { target: container, props: {} });
  const el = container;
  const isDownloadButton = (b: HTMLButtonElement) =>
    (b.textContent ?? '').trim() === m.reports_xtx_download();
  await waitFor(() => Array.from(el.querySelectorAll('button')).some(isDownloadButton));
  Array.from(el.querySelectorAll('button')).find(isDownloadButton)!.click();
  await waitFor(() => vi.mocked(saveTextFile).mock.calls.length > 0);
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

describe('明細欄が上限を超えたときの .xtx 書き出し', () => {
  test('追加科目欄の提示と明細の提示が両方表示され、ファイルは書き出す', async () => {
    await db.accounts.bulkAdd(TEST_ACCOUNTS);
    await addEntryWithExtraExpenses();
    await db.fixedAssets.bulkAdd(businessAssets(9));
    await setUpFiler();

    const text = (await mountAndDownload()).textContent ?? '';

    expect(text).toContain(m.reports_xtx_additional_expense_overflow({ list: '' }).split('：')[0]);
    expect(text).toContain(m.reports_xtx_detail_overflow({ list: '' }).split('：')[0]);
    expect(text).toContain(`KOA210 ${m.reports_xtx_detail_overflow_depreciation()}：資産07`);
    expect(text).toContain(`KOA210 ${m.reports_xtx_detail_overflow_depreciation()}：資産08`);
    expect(text).not.toContain('資産06');
  });

  test('上限に収まるときは明細の提示を表示しない', async () => {
    await db.accounts.bulkAdd(TEST_ACCOUNTS);
    await addEntryWithExtraExpenses();
    await db.fixedAssets.bulkAdd(businessAssets(7));
    await setUpFiler();

    const text = (await mountAndDownload()).textContent ?? '';

    expect(text).toContain(m.reports_xtx_additional_expense_overflow({ list: '' }).split('：')[0]);
    expect(text).not.toContain(m.reports_xtx_detail_overflow({ list: '' }).split('：')[0]);
  });
});
