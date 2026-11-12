import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { setSetting } from '../lib/settings';
import { toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { m } from '../paraglide/messages';
import type { Account, FixedAsset } from '../db/types';

const { saveTextFile } = vi.hoisted(() => ({
  saveTextFile: vi.fn(async (..._args: unknown[]) => 'saved' as const),
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

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function text(): string {
  return container?.textContent ?? '';
}

function buttonByText(label: string): HTMLButtonElement | undefined {
  return Array.from(container!.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label,
  );
}

async function exportXtx(): Promise<string> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Reports, { target: container, props: {} });
  await waitFor(() => buttonByText(m.reports_xtx_download()) !== undefined);
  saveTextFile.mockClear();
  buttonByText(m.reports_xtx_download())!.click();
  await waitFor(() => saveTextFile.mock.calls.length > 0);
  return String(saveTextFile.mock.calls[0]?.[0] ?? '');
}

function smallAsset(i: number): FixedAsset {
  return {
    id: `asset-${i}`,
    name: `PC${i}`,
    acquisitionDate: `2026-08-0${i}`,
    acquisitionCost: '290000',
    usefulLifeYears: 4,
    depreciationMethod: 'small-asset-special',
    accountCode: '1510',
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  const accs: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year: 2026 }));
  await db.accounts.bulkPut(accs);
  await setSetting('currentYear', 2026);
  await setSetting('userRiyoshaId', '1234567890123456');
  await setSetting('userFilerName', '青色 太郎');
  await setSetting('userFilerZip', '1000001');
  await setSetting('userFilerAddress', '東京都千代田区1-1');
  await setSetting('userZeimushoCode', '01101');
  await setSetting('userZeimushoName', '麹町');
  const entryId = newId();
  await db.journalEntries.add({
    id: entryId,
    date: '2026-06-15',
    year: 2026,
    description: '売上',
    status: 'confirmed',
    source: 'manual',
    createdAt: 1,
    confirmedAt: 1,
  });
  await db.journalLines.bulkAdd(
    (['debit', 'credit'] as const).map((side) => ({
      id: newId(),
      entryId,
      side,
      accountCode: side === 'debit' ? '1130' : '4110',
      amount: '1100000',
      amountIndexed: toIndexable('1100000'),
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
    })),
  );
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

describe('.xtx の少額特例の枠も開業仕訳の日付で月割する（G1）', () => {
  test('開業日の設定が無く開業仕訳が 2026-07-01 なら、6 件目は枠を外れて通常の償却額で載る', async () => {
    await db.journalEntries.add({
      id: 'op',
      date: '2026-07-01',
      year: 2026,
      description: '開業費計上（開業設定）',
      status: 'confirmed',
      source: 'opening',
      createdAt: 1,
      confirmedAt: 1,
    });
    await db.fixedAssets.bulkAdd([1, 2, 3, 4, 5, 6].map(smallAsset));
    const xml = await exportXtx();
    expect(xml).toContain('>30208<');
  });
});

describe('開業時未償却残高が取得価額を超える保存済みの資産（G4）', () => {
  test('.xtx は出したうえで、資産名と直し方を示す', async () => {
    await db.fixedAssets.add({
      id: 'conv',
      name: '取得日の誤った転用資産',
      acquisitionDate: '2026-09-01',
      acquisitionCost: '300000',
      conversionBasis: '344820',
      serviceStartDate: '2026-07-01',
      usefulLifeYears: 4,
      depreciationMethod: 'straight-line',
      accountCode: '1510',
      source: 'opening',
      openingYear: 2026,
    });
    await exportXtx();
    await waitFor(() =>
      text().includes(
        m.settings_asset_conversion_basis_exceeds_cost({ names: '取得日の誤った転用資産' }),
      ),
    );
  });
});
