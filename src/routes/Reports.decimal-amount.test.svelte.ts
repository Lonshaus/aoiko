import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { setSetting } from '../lib/settings';
import { newId } from '../lib/id';
import { toIndexable } from '../lib/decimal';
import { saveTextFile } from '../lib/save-file';
import { addArApEntry } from '../domain/cash-flow';
import { m } from '../paraglide/messages';
import type { Account, JournalLine, PersonalDeductionInput } from '../db/types';

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

function named(name: string): HTMLInputElement {
  const el = container!.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (el === null) {
    throw new Error(`input ${name} not found`);
  }
  return el;
}

function type(name: string, value: string): void {
  const el = named(name);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
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

function cellText(name: string): string {
  return named(name).closest('td')?.textContent ?? '';
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

function deductionsWithSalary(paidAmount: string): PersonalDeductionInput {
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
    salaryIncome: { paidAmount, withholdingTax: '0' },
    updatedAt: Date.now(),
  };
}

describe('年度の .xtx 出力は小数を含む金額で止まる', () => {
  test('給与収入が 100.5 なら専用の誤りを示して書き出さず、100 に直すと書き出す', async () => {
    await seedFiler();
    await seedSalesEntry();
    await db.personalDeductions.put(deductionsWithSalary('100.5'));
    await mountReports('budget-revenue-1');

    buttonByText(m.reports_xtx_download()).click();
    await waitFor(() => errorBlocks().length > 0);
    await settle();
    expect(errorBlocks().every((t) => t === m.reports_xtx_amount_invalid())).toBe(true);
    expect(saveTextFile).not.toHaveBeenCalled();

    await db.personalDeductions.put(deductionsWithSalary('100'));
    buttonByText(m.reports_xtx_download()).click();
    await waitFor(() => vi.mocked(saveTextFile).mock.calls.length > 0);
    expect(errorBlocks()).toEqual([]);
  });
});

describe('2 割特例の .xtx 出力は小数を含む調整額で止まる', () => {
  test('売上対価の返還等の消費税額が 10.5 なら入力の誤りを示して書き出さない', async () => {
    await seedFiler();
    await setSetting('wariBaseAdjustments', { 2026: { salesReturnTax78: '10.5' } });
    await mountReports('interimPaidNational');
    await waitFor(() => named('wariSalesReturnTax78').value === '10.5');

    buttonByText(m.reports_consumption_tax_xtx_two_wari_download()).click();
    await waitFor(() =>
      Array.from(container!.querySelectorAll('p.border-destructive')).some(
        (p) => (p.textContent ?? '').trim() === m.common_amount_invalid(),
      ),
    );
    await settle();
    expect(saveTextFile).not.toHaveBeenCalled();
  });
});

describe('予算の保存', () => {
  test('ある月の予算が 100.5 なら保存せず、その月の下に入力の誤りを示す', async () => {
    await mountReports('budget-revenue-3');
    type('budget-revenue-3', '100.5');
    expect(cellText('budget-revenue-3')).toContain(m.common_amount_invalid());

    buttonByText(m.reports_budget_save()).click();
    await settle();
    expect(await db.budgets.count()).toBe(0);
  });
});

describe('売掛金・買掛金の消込', () => {
  async function seed(): Promise<{ whole: string; fractional: string }> {
    await addArApEntry({
      type: 'receivable',
      description: 'A社',
      dueDate: '2026-11-30',
      originalAmount: '10000',
    });
    await addArApEntry({
      type: 'receivable',
      description: 'B社',
      dueDate: '2026-12-31',
      originalAmount: '108.9',
    });
    const [whole, fractional] = await db.arApEntries.orderBy('dueDate').toArray();
    await mountReports(`arap-payment-${whole!.id}`);
    return { whole: whole!.id, fractional: fractional!.id };
  }

  function recordButton(id: string): HTMLButtonElement {
    return named(`arap-payment-${id}`).parentElement!.querySelector('button')!;
  }

  test('小数の残高は残高欄に小数のまま表示される', async () => {
    const { fractional } = await seed();
    const remaining = named(`arap-payment-${fractional}`).closest('tr')!.querySelectorAll('td')[4];
    expect(remaining?.textContent).toContain('¥108.9');
  });

  test('小数の残高ちょうどの額は誤りと示さず、消込を記録して残高が 0 になる', async () => {
    const { fractional } = await seed();
    type(`arap-payment-${fractional}`, '108.9');
    expect(cellText(`arap-payment-${fractional}`)).not.toContain(m.common_amount_invalid());
    recordButton(fractional).click();
    await waitFor(async () => (await db.arApEntries.get(fractional))!.paidAmount === '108.9');
  });

  test('整数の残高に 100.5 を入力すると入力の誤りを示し、消込を記録しない', async () => {
    const { whole } = await seed();
    type(`arap-payment-${whole}`, '100.5');
    expect(cellText(`arap-payment-${whole}`)).toContain(m.common_amount_invalid());
    recordButton(whole).click();
    await settle();
    expect((await db.arApEntries.get(whole))!.paidAmount).toBe('0');
  });
});
