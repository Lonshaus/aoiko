import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { setSetting } from '../lib/settings';
import { newId } from '../lib/id';
import { toIndexable } from '../lib/decimal';
import { saveTextFile } from '../lib/save-file';
import { ledger } from '../stores/ledger.svelte';
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

function deductions(realEstateLoanInterest: string): PersonalDeductionInput {
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
    realEstateIncome: { businessScale: false, landLoanInterestAmount: realEstateLoanInterest },
    updatedAt: Date.now(),
  };
}

function disposedAsset(salePrice: string): FixedAsset {
  return {
    id: 'asset-1',
    name: '売却済みの機材',
    acquisitionDate: '2025-01-01',
    acquisitionCost: '1000000',
    usefulLifeYears: 10,
    depreciationMethod: 'straight-line',
    accountCode: '1510',
    disposedDate: '2026-03-31',
    disposalType: 'sale',
    salePrice,
  };
}

async function setRealEstateEnabled(enabled: boolean): Promise<void> {
  await setSetting('realEstateIncomeEnabled', enabled);
  await waitFor(() => ledger.realEstateIncomeEnabled === enabled);
}

describe('年度の .xtx の金額検査は不動産所得が有効なときだけ不動産所得の欄を見る', () => {
  test('不動産所得が無効なら、土地の借入金利子が 100.5 でも年度 .xtx を書き出す', async () => {
    await seedFiler();
    await seedSalesEntry();
    await setRealEstateEnabled(false);
    await db.personalDeductions.put(deductions('100.5'));
    await mountReports('budget-revenue-1');

    buttonByText(m.reports_xtx_download()).click();
    await waitFor(() => vi.mocked(saveTextFile).mock.calls.length > 0);
    expect(errorBlocks().includes(m.reports_xtx_amount_invalid())).toBe(false);
  });

  test('不動産所得が有効なら、同じ入力で専用の誤りを示して書き出さない', async () => {
    await seedFiler();
    await seedSalesEntry();
    await setRealEstateEnabled(true);
    await db.personalDeductions.put(deductions('100.5'));
    await mountReports('budget-revenue-1');

    buttonByText(m.reports_xtx_download()).click();
    await waitFor(() => errorBlocks().length > 0);
    await settle();
    expect(errorBlocks().every((t) => t === m.reports_xtx_amount_invalid())).toBe(true);
    expect(saveTextFile).not.toHaveBeenCalled();
  });

  test('不動産所得が無効なら、処分済み資産の売価が 100.5 でも年度 .xtx を書き出す', async () => {
    await seedFiler();
    await seedSalesEntry();
    await setRealEstateEnabled(false);
    await db.fixedAssets.add(disposedAsset('100.5'));
    await mountReports('budget-revenue-1');

    buttonByText(m.reports_xtx_download()).click();
    await waitFor(() => vi.mocked(saveTextFile).mock.calls.length > 0);
    expect(errorBlocks().includes(m.reports_xtx_amount_invalid())).toBe(false);
  });
});

function propertyAsset(detail: unknown): FixedAsset {
  return {
    id: 'property-1',
    name: '賃貸アパート',
    acquisitionDate: '2025-01-01',
    acquisitionCost: '1000000',
    usefulLifeYears: 10,
    depreciationMethod: 'straight-line',
    accountCode: '1510',
    incomeType: 'realEstate',
    realEstateDetail: detail as NonNullable<FixedAsset['realEstateDetail']>,
  };
}

describe('年度の .xtx は物件明細の文字欄が文字列でないと専用の誤りを示して書き出さない', () => {
  test.each([
    ['propertyType が数値', { propertyType: 123, address: '東京都', annualRent: '1200000' }],
    [
      'areaSqm が数値',
      { propertyType: '貸家', address: '東京都', annualRent: '1200000', areaSqm: 45 },
    ],
  ])('不動産所得が有効で %s のとき', async (_label, detail) => {
    await seedFiler();
    await seedSalesEntry();
    await setRealEstateEnabled(true);
    await db.personalDeductions.put(deductions('0'));
    await db.fixedAssets.add(propertyAsset(detail));
    await mountReports('budget-revenue-1');

    buttonByText(m.reports_xtx_download()).click();
    await waitFor(() => errorBlocks().length > 0);
    await settle();
    expect(errorBlocks().every((t) => t === m.reports_xtx_property_text_invalid())).toBe(true);
    expect(saveTextFile).not.toHaveBeenCalled();
  });

  test('realEstateDetail が null の資産があっても、どちらの誤りも示さず書き出す', async () => {
    await seedFiler();
    await seedSalesEntry();
    await setRealEstateEnabled(true);
    await db.personalDeductions.put(deductions('0'));
    await db.fixedAssets.add(propertyAsset(null));
    await mountReports('budget-revenue-1');

    buttonByText(m.reports_xtx_download()).click();
    await waitFor(() => vi.mocked(saveTextFile).mock.calls.length > 0);
    expect(errorBlocks().includes(m.reports_xtx_amount_invalid())).toBe(false);
    expect(errorBlocks().includes(m.reports_xtx_property_text_invalid())).toBe(false);
  });
});
