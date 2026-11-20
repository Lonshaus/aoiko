import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { setSetting } from '../lib/settings';
import { newId } from '../lib/id';
import { formatJPY, toIndexable } from '../lib/decimal';
import { saveTextFile } from '../lib/save-file';
import { m } from '../paraglide/messages';
import type { Account, JournalLine } from '../db/types';

vi.mock('../lib/save-file', () => ({
  saveTextFile: vi.fn(async () => 'saved' as const),
}));
// S1 では総合譲渡があると出力を止めるため、行数の上限を超える状態は止める判定を外して作る
vi.mock('../tax-schema/2026/xtx-mapping-koa020', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tax-schema/2026/xtx-mapping-koa020')>()),
  koa020InputBlocker: () => undefined,
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

test('総合譲渡・一時所得の第二表が 2 行を超えると、3 行目を提示して書き出す', async () => {
  await seedFiler();
  await seedSalesEntry();
  await db.personalDeductions.put({
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
    generalTransferIncome: [
      { term: 'short', revenue: '900000', acquisitionCost: '300000' },
      { term: 'long', revenue: '800000' },
    ],
    occasionalIncome: { revenue: '1500000', payerName: '青空生命保険' },
    updatedAt: Date.now(),
  });
  await mountReports('budget-revenue-1');
  buttonByText(m.reports_xtx_download()).click();
  await waitFor(() => vi.mocked(saveTextFile).mock.calls.length > 0);
  await settle();
  expect(container!.textContent).toContain(
    `KOA020 ${m.reports_xtx_detail_overflow_transfer_income()}：一時（${formatJPY('1500000')}）`,
  );
});
