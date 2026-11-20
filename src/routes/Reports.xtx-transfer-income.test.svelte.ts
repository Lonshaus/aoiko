import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { setSetting } from '../lib/settings';
import { newId } from '../lib/id';
import { toIndexable } from '../lib/decimal';
import { saveTextFile } from '../lib/save-file';
import { m } from '../paraglide/messages';
import type { Account, FixedAsset, JournalLine, PersonalDeductionInput } from '../db/types';

vi.mock('../lib/save-file', () => ({
  saveTextFile: vi.fn(async () => 'saved' as const),
}));

const { default: Reports } = await import('./Reports.svelte');

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 4000,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const settle = () => new Promise((r) => setTimeout(r, 50));

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  await db.delete();
  await db.open();
  const accs: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year: 2026 }));
  await db.accounts.bulkPut(accs);
  await setSetting('currentYear', 2026);
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

async function mountReports(ready: string): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Reports, { target: container, props: {} });
  await waitFor(() => container!.querySelector(`input[name="${ready}"]`) !== null);
}

function buttonByText(text: string): HTMLButtonElement {
  const el = Array.from(container!.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === text,
  );
  if (el === undefined) {
    throw new Error(`button ${text} not found`);
  }
  return el;
}

function errorBlocks(): string[] {
  return Array.from(container!.querySelectorAll('div.border-destructive')).map((d) =>
    (d.textContent ?? '').trim(),
  );
}

async function seedFiler(): Promise<void> {
  await setSetting('userRiyoshaId', '1234567890123456');
  await setSetting('userFilerName', '青井 太郎');
  await setSetting('userFilerZip', '1800001');
  await setSetting('userFilerAddress', '東京都武蔵野市〇〇1-2-3');
  await setSetting('userZeimushoCode', '01101');
  await setSetting('userZeimushoName', '麹町');
}

async function seedSalesEntry(): Promise<void> {
  const entryId = newId();
  const now = Date.now();
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
}

function deductions(
  occasional: PersonalDeductionInput['occasionalIncome'],
): PersonalDeductionInput {
  return {
    year: 2026,
    socialInsurancePaid: '0',
    smallBusinessMutualAidPaid: '0',
    lifeInsurance: {},
    earthquakeInsurancePaid: '0',
    oldLongTermInsurancePaid: '0',
    medicalExpensePaid: '0',
    medicalInsuranceReimbursement: '0',
    donationAmount: '0',
    casualtyLossDeduction: '0',
    isDisabled: false,
    isSpecialDisabled: false,
    isSingleParent: false,
    isWidow: false,
    isWorkingStudent: false,
    dependents: [],
    ...(occasional ? { occasionalIncome: occasional } : {}),
    updatedAt: Date.now(),
  };
}

function soldAsset(over: Partial<FixedAsset> = {}): FixedAsset {
  return {
    id: 'asset-1',
    name: '売却した機材',
    acquisitionDate: '2024-01-01',
    acquisitionCost: '1000000',
    usefulLifeYears: 10,
    depreciationMethod: 'straight-line',
    accountCode: '1510',
    disposedDate: '2026-03-31',
    disposalType: 'sale',
    salePrice: '800000',
    ...over,
  };
}

async function download(): Promise<void> {
  await mountReports('budget-revenue-1');
  buttonByText(m.reports_xtx_download()).click();
}

function savedXml(): string {
  return String(vi.mocked(saveTextFile).mock.calls[0]![0]);
}

describe('総合課税の譲渡・一時所得がある年度の .xtx', () => {
  test('一時所得だけ（支払者の名称あり）なら書き出し、第一表・第二表に値が入る', async () => {
    await seedFiler();
    await seedSalesEntry();
    await db.personalDeductions.put(
      deductions({
        revenue: '1500000',
        expenses: '0',
        category: '生命保険の満期返戻金',
        payerName: '青空生命保険',
        payerAddress: '東京都千代田区1-1',
      }),
    );
    await download();
    await waitFor(() => vi.mocked(saveTextFile).mock.calls.length > 0);
    const xml = savedXml();
    expect(xml).toContain('<ABB00230>1000000</ABB00230>');
    expect(xml).toContain('<ABB00400>500000</ABB00400>');
    expect(xml).toContain('<ABX00250>一時</ABX00250>');
    expect(xml).toContain('<ABX00260>1500000</ABX00260>');
    expect(xml).toContain('<ABX00310>1500000</ABX00310>');
    expect(xml).toContain('<ABD00020>一時</ABD00020>');
    expect(xml).toContain('<ABD00050>1500000</ABD00050>');
  });

  test('一時所得に支払者の名称がなければ、入力を促して書き出さない', async () => {
    await seedFiler();
    await seedSalesEntry();
    await db.personalDeductions.put(deductions({ revenue: '1500000', payerName: '' }));
    await download();
    await waitFor(() => errorBlocks().length > 0);
    await settle();
    expect(errorBlocks()).toEqual([m.reports_xtx_occasional_payer_missing()]);
    expect(saveTextFile).not.toHaveBeenCalled();
  });

  test('当年に固定資産を売却していて（所得控除の入力がなくても）KOC020 が要る案内で書き出さない', async () => {
    await seedFiler();
    await seedSalesEntry();
    await db.fixedAssets.add(soldAsset());
    await download();
    await waitFor(() => errorBlocks().length > 0);
    await settle();
    expect(errorBlocks()).toEqual([m.reports_xtx_transfer_koc020()]);
    expect(saveTextFile).not.toHaveBeenCalled();
  });

  test('当年に売却した資産に計算できない問題があれば、資産名つきで書き出さない', async () => {
    await seedFiler();
    await seedSalesEntry();
    await db.fixedAssets.add(soldAsset({ name: '耐用年数が不正の機材', usefulLifeYears: 0 }));
    await download();
    await waitFor(() => errorBlocks().length > 0);
    await settle();
    const blocks = errorBlocks();
    expect(blocks.length).toBe(1);
    expect(blocks[0]).toContain('耐用年数が不正の機材');
    expect(saveTextFile).not.toHaveBeenCalled();
  });

  test('建物の売却だけなら書き出す（総合譲渡に入れない）', async () => {
    await seedFiler();
    await seedSalesEntry();
    await db.fixedAssets.add(
      soldAsset({
        name: '事務所建物',
        accountCode: '1511',
        usefulLifeYears: 24,
        salePrice: '9000000',
      }),
    );
    await download();
    await waitFor(() => vi.mocked(saveTextFile).mock.calls.length > 0);
    const xml = savedXml();
    expect(xml).not.toContain('<ABB00130>');
    expect(xml).not.toContain('<ABB00180>');
    expect(xml).not.toContain('<ABB00400>');
  });

  test('当年に処分した資産がなければ、無関係な資産の問題があっても従来どおり書き出す', async () => {
    await seedFiler();
    await seedSalesEntry();
    await db.fixedAssets.add(soldAsset({ name: '前年に売却した機材', disposedDate: '2025-03-31' }));
    await download();
    await waitFor(() => vi.mocked(saveTextFile).mock.calls.length > 0);
    expect(errorBlocks()).toEqual([]);
  });
});
