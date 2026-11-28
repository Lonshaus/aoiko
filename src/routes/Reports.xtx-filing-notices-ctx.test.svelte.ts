// 所得控除画面で入力した届出事項が、Reports の .xtx 書き出しで XtxContext.filingNotices に渡り、
// 青色申告の取りやめが不動産所得用の様式を出すときにだけ不動産用の部分にも入ることを見る。

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
import type { Account, JournalLine, PersonalDeductionInput } from '../db/types';
import type { XtxContext } from '../tax-schema/2026/xtx';

const captured: { ctx: XtxContext | undefined } = { ctx: undefined };

vi.mock('../lib/save-file', () => ({
  saveTextFile: vi.fn(async () => 'saved' as const),
}));

vi.mock('../tax-schema/2026/xtx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tax-schema/2026/xtx')>();
  return {
    ...actual,
    buildXtx2026: (ctx: XtxContext) => {
      captured.ctx = ctx;
      return actual.buildXtx2026(ctx);
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

async function addEntry(year: number): Promise<void> {
  const entryId = newId();
  const now = Date.now();
  await db.transaction('rw', [db.journalEntries, db.journalLines], async () => {
    await db.journalEntries.add({
      id: entryId,
      date: `${year}-05-01`,
      year,
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
    await db.journalLines.bulkAdd([line('debit', '1110'), line('credit', '4110')]);
  });
}

async function setUp(year: number): Promise<void> {
  const accounts: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year }));
  await db.accounts.bulkPut(accounts);
  await addEntry(year);
  await setSetting('userRiyoshaId', '1234567890123456');
  await setSetting('userFilerName', '青井 太郎');
  await setSetting('userFilerZip', '1800001');
  await setSetting('userFilerAddress', '東京都武蔵野市〇〇1-2-3');
  await setSetting('userZeimushoCode', '01101');
  await setSetting('userZeimushoName', '麹町');
  await setSetting('filingType', 'blue');
  await setSetting('aoiroDeductionKind', 'electronic');
  await setSetting('currentYear', year);
  await waitFor(() => ledger.currentYear === year);
}

function deductions(
  year: number,
  overrides: Partial<PersonalDeductionInput> = {},
): PersonalDeductionInput {
  return {
    year,
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
    updatedAt: Date.now(),
    ...overrides,
  };
}

const depreciationNotice = {
  kind: 'change',
  assetType: 'depreciable',
  businessOrAssetType: '製造業',
  assetClass: '備品',
  newMethod: '定額法',
  currentMethod: '定率法',
  currentAdoptedYear: 2020,
  memo: '変更',
} as const;

const inventoryNotice = {
  kind: 'notice',
  assetType: 'inventory',
  businessOrAssetType: '小売業',
  assetClass: '商品',
  newMethod: '先入先出法',
} as const;

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

async function download(): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Reports, { target: container, props: {} });
  const el = container;
  const isDownload = (b: HTMLButtonElement) =>
    (b.textContent ?? '').trim() === m.reports_xtx_download();
  await waitFor(() => Array.from(el.querySelectorAll('button')).some(isDownload));
  Array.from(el.querySelectorAll('button')).find(isDownload)!.click();
  return el;
}

const overflowPrefix = m.reports_xtx_filing_notice_overflow({ list: '' }).split('：')[0]!;

async function expectWritten(el: HTMLElement, noticeOverflow = false): Promise<void> {
  await waitFor(() => vi.mocked(saveTextFile).mock.calls.length > 0);
  expect(vi.mocked(saveTextFile)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(saveTextFile).mock.calls[0]?.[1]).toBe('aoiko-2026.xtx');
  if (noticeOverflow) {
    expect(el.textContent).toContain(overflowPrefix);
    expect(el.textContent).not.toContain(
      m.reports_xtx_detail_overflow({ list: '' }).split('：')[0]!,
    );
  } else {
    expect(el.textContent).not.toContain(overflowPrefix);
  }
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  captured.ctx = undefined;
  await setSetting('realEstateIncomeEnabled', false);
  await waitFor(() => !ledger.realEstateIncomeEnabled);
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

describe('届出事項が XtxContext.filingNotices に渡る', () => {
  test('書き出していない旨の提示は無くなっている', () => {
    const keys = Object.keys(m);
    expect(keys).toContain('reports_xtx_filing_notice_overflow');
    expect(keys.filter((k) => k.startsWith('reports_xtx_filing_notices_'))).toEqual([]);
  });

  test('不動産所得の様式を出さないとき、取りやめは事業用だけに入り、不動産用の届出は入りきらなかった届出として提示する', async () => {
    await setUp(2026);
    await db.personalDeductions.put(
      deductions(2026, {
        filingNotices: {
          blueReturnWithdrawalYear: 2027,
          business: { closureDate: '2026-06-30', methodApplications: [depreciationNotice] },
          realEstate: { closureDate: '2026-09-30', methodApplications: [inventoryNotice] },
        },
      }),
    );
    const el = await download();
    await expectWritten(el, true);

    expect(captured.ctx?.filingNotices?.business).toEqual({
      closureDate: '2026-06-30',
      blueReturnWithdrawalYear: 2027,
      methodApplications: [depreciationNotice],
    });
    expect(captured.ctx?.filingNotices?.realEstate).toEqual({
      closureDate: '2026-09-30',
      methodApplications: [inventoryNotice],
    });
    expect(captured.ctx?.filingNotices?.realEstate).not.toHaveProperty('blueReturnWithdrawalYear');
  });

  test('取りやめだけのときは事業用に取りやめ年分と空の明細だけが入る', async () => {
    await setUp(2026);
    await db.personalDeductions.put(
      deductions(2026, { filingNotices: { blueReturnWithdrawalYear: 2027 } }),
    );
    const el = await download();
    await expectWritten(el);

    expect(captured.ctx?.filingNotices).toEqual({
      business: { blueReturnWithdrawalYear: 2027, methodApplications: [] },
    });
  });

  test('事業用だけのとき、ファイルを書き出す', async () => {
    await setUp(2026);
    await db.personalDeductions.put(
      deductions(2026, {
        filingNotices: { business: { closureDate: '2026-06-30', methodApplications: [] } },
      }),
    );
    const el = await download();
    await expectWritten(el);

    expect(captured.ctx?.filingNotices).toEqual({
      business: { closureDate: '2026-06-30', methodApplications: [] },
    });
  });

  test('不動産用だけで不動産所得の様式も出すとき、ファイルを書き出す', async () => {
    await setUp(2026);
    await setSetting('realEstateIncomeEnabled', true);
    await waitFor(() => ledger.realEstateIncomeEnabled);
    await db.personalDeductions.put(
      deductions(2026, {
        realEstateIncome: { businessScale: false, landLoanInterestAmount: '0' },
        filingNotices: { realEstate: { closureDate: '2026-09-30', methodApplications: [] } },
      }),
    );
    const el = await download();
    await expectWritten(el);

    expect(captured.ctx?.realEstatePl).toBeDefined();
    expect(captured.ctx?.filingNotices).toEqual({
      realEstate: { closureDate: '2026-09-30', methodApplications: [] },
    });
  });

  test('取りやめがあり不動産所得の様式も出すとき、不動産用にも同じ取りやめ年分が入る', async () => {
    await setUp(2026);
    await setSetting('realEstateIncomeEnabled', true);
    await waitFor(() => ledger.realEstateIncomeEnabled);
    await db.personalDeductions.put(
      deductions(2026, {
        realEstateIncome: { businessScale: false, landLoanInterestAmount: '0' },
        filingNotices: { blueReturnWithdrawalYear: 2027 },
      }),
    );
    const el = await download();
    await expectWritten(el);

    expect(captured.ctx?.realEstatePl).toBeDefined();
    expect(captured.ctx?.filingNotices).toEqual({
      business: { blueReturnWithdrawalYear: 2027, methodApplications: [] },
      realEstate: { blueReturnWithdrawalYear: 2027, methodApplications: [] },
    });
    const xml = String(vi.mocked(saveTextFile).mock.calls[0]?.[0]);
    expect(xml).toContain(
      '<ANI00030><kubun_CD>1</kubun_CD></ANI00030><ANI00040><gen:era>5</gen:era><gen:yy>9</gen:yy></ANI00040>',
    );
  });

  test('白色申告でも、不動産所得用の収支内訳書に同じ取りやめ年分が入る', async () => {
    await setUp(2026);
    await setSetting('filingType', 'white');
    await setSetting('realEstateIncomeEnabled', true);
    await waitFor(() => ledger.realEstateIncomeEnabled);
    await db.personalDeductions.put(
      deductions(2026, {
        realEstateIncome: { businessScale: false, landLoanInterestAmount: '0' },
        filingNotices: { blueReturnWithdrawalYear: 2027 },
      }),
    );
    const el = await download();
    await expectWritten(el);

    const xml = String(vi.mocked(saveTextFile).mock.calls[0]?.[0]);
    expect(xml).toContain(
      '<AKS00030><kubun_CD>1</kubun_CD></AKS00030><AKS00040><gen:era>5</gen:era><gen:yy>9</gen:yy></AKS00040>',
    );
  });

  test('届出事項が無いとき、filingNotices は無い', async () => {
    await setUp(2026);
    await db.personalDeductions.put(deductions(2026));
    const el = await download();
    await waitFor(() => vi.mocked(saveTextFile).mock.calls.length > 0);

    expect(captured.ctx).toBeDefined();
    expect(captured.ctx?.filingNotices).toBeUndefined();
    expect(el.textContent).not.toContain(overflowPrefix);
    expect(vi.mocked(saveTextFile)).toHaveBeenCalledTimes(1);
  });

  test('不動産用に内容が無いとき、不動産用は渡さず、事業用だけを渡す', async () => {
    await setUp(2026);
    await db.personalDeductions.put(
      deductions(2026, {
        filingNotices: {
          business: { closureDate: '2026-06-30', methodApplications: [] },
          realEstate: { methodApplications: [] },
        },
      }),
    );
    const el = await download();
    await expectWritten(el);

    expect(captured.ctx?.filingNotices?.business).toBeDefined();
    expect(captured.ctx?.filingNotices?.realEstate).toBeUndefined();
  });

  test('不動産用だけで内容が無いときは、filingNotices を渡さない', async () => {
    await setUp(2026);
    await db.personalDeductions.put(
      deductions(2026, { filingNotices: { realEstate: { methodApplications: [] } } }),
    );
    const el = await download();
    await waitFor(() => vi.mocked(saveTextFile).mock.calls.length > 0);

    expect(captured.ctx?.filingNotices).toBeUndefined();
    expect(el.textContent).not.toContain(overflowPrefix);
  });

  test('2025 年度は .xtx の書き出しが未対応で止まり、届出事項があっても buildXtx2026 を呼ばない', async () => {
    await setUp(2025);
    await db.personalDeductions.put(
      deductions(2025, {
        filingNotices: { business: { closureDate: '2025-06-30', methodApplications: [] } },
      }),
    );
    const el = await download();
    await waitFor(() =>
      (el.textContent ?? '').includes(m.reports_xtx_unsupported_year({ year: 2025 })),
    );

    expect(captured.ctx).toBeUndefined();
    expect(saveTextFile).not.toHaveBeenCalled();
    expect(el.textContent).not.toContain(overflowPrefix);
  });
});
