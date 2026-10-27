import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { setSetting } from '../lib/settings';
import { toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { m } from '../paraglide/messages';
import type { Account } from '../db/types';

const { saveTextFile } = vi.hoisted(() => ({
  saveTextFile: vi.fn(async () => 'saved' as const),
}));
vi.mock('../lib/save-file', () => ({ saveTextFile }));

const { default: Reports } = await import('./Reports.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function seedSale(year: number): Promise<void> {
  const entryId = newId();
  const now = Date.now();
  await db.journalEntries.add({
    id: entryId,
    date: `${year}-06-15`,
    year,
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
      amount: '1100000',
      amountIndexed: toIndexable('1100000'),
      taxRate: side === 'credit' ? 0.1 : 0,
      taxIncluded: true,
      invoiceCompliant: false,
    })),
  );
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function buttonByText(label: string): HTMLButtonElement | undefined {
  return Array.from(container!.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label,
  );
}

async function seedFiler(riyoshaId: string, zip: string): Promise<void> {
  await setSetting('userRiyoshaId', riyoshaId);
  await setSetting('userFilerName', '青色 太郎');
  await setSetting('userFilerZip', zip);
  await setSetting('userFilerAddress', '東京都千代田区1-1');
  await setSetting('userZeimushoCode', '01101');
  await setSetting('userZeimushoName', 'テスト税務署');
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  const accs: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year: 2026 }));
  await db.accounts.bulkPut(accs);
  await setSetting('currentYear', 2026);
  await setSetting('taxRegistration', 'taxable');
  await setSetting('simplifiedTaxCategory', 4);
  await seedSale(2026);
  saveTextFile.mockClear();
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

describe('保存済みの申告者情報が不正なときの .xtx 出力', () => {
  test.each([
    m.reports_xtx_download(),
    m.reports_consumption_tax_xtx_simplified_download(),
    m.reports_consumption_tax_xtx_general_download(),
    m.reports_consumption_tax_xtx_two_wari_download(),
  ])('「%s」は停止して案内を出し、ファイルを出力しない', async (label) => {
    await seedFiler('1234', '123');
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });
    await waitFor(() => buttonByText(label) !== undefined);

    buttonByText(label)!.click();
    await waitFor(() => (container!.textContent ?? '').includes(m.reports_xtx_filer_invalid()));

    expect(saveTextFile).not.toHaveBeenCalled();
  });
});
