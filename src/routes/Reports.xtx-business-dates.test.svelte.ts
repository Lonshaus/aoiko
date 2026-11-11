import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { setSetting } from '../lib/settings';
import {
  loadEffectiveBusinessDates,
  readBusinessDateSources,
  selectEffectiveBusinessDates,
} from '../domain/depreciation';
import { m } from '../paraglide/messages';
import type { Account } from '../db/types';

const { saveTextFile, buildSpy, buildTwoWariSpy } = vi.hoisted(() => ({
  saveTextFile: vi.fn(async (..._args: unknown[]) => 'saved' as const),
  buildSpy: vi.fn(),
  buildTwoWariSpy: vi.fn(),
}));
vi.mock('../lib/save-file', () => ({ saveTextFile }));
vi.mock('../tax-schema/2026/xtx-consumption-tax', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tax-schema/2026/xtx-consumption-tax')>();
  buildTwoWariSpy.mockImplementation(actual.buildTwoWariXtx);
  return { ...actual, buildTwoWariXtx: buildTwoWariSpy };
});
vi.mock('../tax-schema/2026/xtx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tax-schema/2026/xtx')>();
  buildSpy.mockImplementation(actual.buildXtx2026);
  return { ...actual, buildXtx2026: buildSpy };
});

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

function buttonByText(label: string): HTMLButtonElement | undefined {
  return Array.from(container!.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label,
  );
}

async function exportXtxCtx(): Promise<{
  businessStartDates?: string[];
  businessCloseDate?: string;
}> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Reports, { target: container, props: {} });
  await waitFor(() => buttonByText(m.reports_xtx_download()) !== undefined);
  buildSpy.mockClear();
  saveTextFile.mockClear();
  buttonByText(m.reports_xtx_download())!.click();
  await waitFor(() => saveTextFile.mock.calls.length > 0);
  expect(buildSpy).toHaveBeenCalledTimes(1);
  return buildSpy.mock.calls[0]![0] as {
    businessStartDates?: string[];
    businessCloseDate?: string;
  };
}

async function addOpeningEntry(id: string, date: string): Promise<void> {
  await db.journalEntries.add({
    id,
    date,
    year: Number(date.slice(0, 4)),
    description: '開業費計上（開業設定）',
    status: 'confirmed',
    source: 'opening',
    createdAt: 1,
    confirmedAt: 1,
  });
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
  await db.journalEntries.add({
    id: 'sale',
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
      id: `sale-${side}`,
      entryId: 'sale',
      side,
      accountCode: side === 'debit' ? '1130' : '4110',
      amount: '1100000',
      amountIndexed: '00000001100000.00',
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
    })),
  );
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

describe('.xtx の組み立てに渡る開業日・廃業日（T183-05）', () => {
  test('開業仕訳のある年は仕訳の日付、仕訳の無い年は設定値で、廃業日は設定値。設定画面・減価償却と同じ値', async () => {
    await addOpeningEntry('op-2026', '2026-07-01');
    await setSetting('businessStartDate', '2025-09-10');
    await setSetting('businessCloseDate', '2026-11-20');
    const ctx = await exportXtxCtx();
    expect(ctx.businessStartDates).toEqual(['2025-09-10', '2026-07-01']);
    expect(ctx.businessCloseDate).toBe('2026-11-20');
    const effective = await loadEffectiveBusinessDates();
    expect(ctx.businessStartDates).toEqual(effective.businessStartDates);
    expect(ctx.businessCloseDate).toBe(effective.businessCloseDate);
    const shown = selectEffectiveBusinessDates(await readBusinessDateSources());
    expect(shown.startSources).toEqual([
      { year: 2025, date: '2025-09-10', source: 'setting' },
      { year: 2026, date: '2026-07-01', source: 'opening-entry' },
    ]);
  });

  test('同じ年に設定値と開業仕訳があるときは開業仕訳の日付だけを渡す', async () => {
    await addOpeningEntry('op-2026', '2026-07-01');
    await setSetting('businessStartDate', '2026-02-01');
    const ctx = await exportXtxCtx();
    expect(ctx.businessStartDates).toEqual(['2026-07-01']);
    expect(ctx.businessCloseDate).toBeUndefined();
  });

  test('開業仕訳が無い年は設定値の開業日を渡す', async () => {
    await setSetting('businessStartDate', '2026-02-10');
    await setSetting('businessCloseDate', '2026-09-30');
    const ctx = await exportXtxCtx();
    expect(ctx.businessStartDates).toEqual(['2026-02-10']);
    expect(ctx.businessCloseDate).toBe('2026-09-30');
  });
});

describe('.xtx の組み立てに失敗したとき', () => {
  test('原因を画面上部に示し、ファイルを出力しない', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });
    await waitFor(() => buttonByText(m.reports_xtx_download()) !== undefined);
    saveTextFile.mockClear();
    buildSpy.mockImplementationOnce(() => {
      throw new Error('組み立ての失敗（試験）');
    });
    buttonByText(m.reports_xtx_download())!.click();
    await waitFor(() => (container!.textContent ?? '').includes('組み立ての失敗（試験）'));
    expect(saveTextFile).not.toHaveBeenCalled();
  });
});

describe('消費税の .xtx の組み立てに失敗したとき', () => {
  test('原因を「消費税」の欄に示し、ファイルを出力しない', async () => {
    await setSetting('taxRegistration', 'taxable');
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });
    const label = m.reports_consumption_tax_xtx_two_wari_download();
    await waitFor(() => buttonByText(label) !== undefined);
    saveTextFile.mockClear();
    buildTwoWariSpy.mockImplementationOnce(() => {
      throw new Error('消費税の組み立ての失敗（試験）');
    });
    buttonByText(label)!.click();
    await waitFor(() => (container!.textContent ?? '').includes('消費税の組み立ての失敗（試験）'));
    const section = buttonByText(label)!.closest('section')!;
    expect(section.textContent).toContain('消費税の組み立ての失敗（試験）');
    expect(saveTextFile).not.toHaveBeenCalled();
  });
});
