import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { toIndexable } from '../lib/decimal';
import { m } from '../paraglide/messages';
import type { Account } from '../db/types';

const { default: IncomeDeductions } = await import('./IncomeDeductions.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
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

function saveButton(): HTMLButtonElement {
  return Array.from(container!.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === m.income_deductions_save(),
  )!;
}

function setYear(value: string): void {
  const input = container!.querySelector<HTMLInputElement>('input[name="deductionNen"]')!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

async function render(year: string): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(IncomeDeductions, { target: container, props: {} });
  await waitFor(() => container!.querySelector('input[name="deductionNen"]') !== null);
  setYear(year);
}

async function seedSale(year: number, amount: string): Promise<void> {
  const id = `e${year}`;
  await db.journalEntries.add({
    id,
    date: `${year}-05-01`,
    year,
    description: '売上',
    status: 'confirmed',
    source: 'manual',
    createdAt: 1,
    confirmedAt: 1,
  });
  await db.journalLines.bulkAdd(
    (['debit', 'credit'] as const).map((side) => ({
      id: `${id}-${side}`,
      entryId: id,
      side,
      accountCode: side === 'debit' ? '1110' : '4110',
      amount,
      amountIndexed: toIndexable('0'),
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
    })),
  );
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  for (const year of [2025, 2026]) {
    const accs: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year }));
    await db.accounts.bulkPut(accs);
  }
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

describe('年の欄（R12）', () => {
  test('年を空にすると保存を止めて案内し、直前の年へ書かない', async () => {
    await render('2026');
    await waitFor(() => !saveButton().disabled);
    setYear('');
    expect(saveButton().disabled).toBe(true);
    expect(container!.textContent).toContain(m.common_integer_invalid({ min: 2020, max: 2099 }));
    saveButton().click();
    await new Promise((r) => setTimeout(r, 50));
    expect(await db.personalDeductions.count()).toBe(0);
  });
});

describe('年の帳簿を読み込めないとき（R20）', () => {
  test('理由を示し、前の年の損益を試算に使わず、保存もしない', async () => {
    await seedSale(2025, '1234567');
    await seedSale(2026, 'abc');
    await render('2025');
    await waitFor(() => !saveButton().disabled);
    const totalLine = () =>
      Array.from(container!.querySelectorAll('p')).find((p) =>
        p.textContent?.startsWith(m.income_deductions_total_income_label()),
      )?.textContent ?? '';
    const loaded2025 = totalLine();
    expect(loaded2025).not.toContain('¥0');
    setYear('2026');
    await waitFor(() =>
      (container!.textContent ?? '').includes(m.income_deductions_load_failed_short()),
    );
    expect(container!.querySelector('[role="alert"]')?.textContent).toContain(
      m.income_deductions_load_failed({ message: '' }).slice(0, 8),
    );
    expect(totalLine()).not.toBe(loaded2025);
    expect(saveButton().disabled).toBe(true);
  });
});
describe('配偶者・不動産所得が false の記録', () => {
  test.each(['spouse', 'realEstateIncome'])(
    '%s が false でも保存済みの値を欄へ読み込む',
    async (key) => {
      await db.personalDeductions.put({
        year: 2026,
        socialInsurancePaid: '123456',
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
        updatedAt: 1,
        [key]: false,
      } as never);
      await render('2026');
      const input = () =>
        container!.querySelector<HTMLInputElement>('input[name="socialInsurancePaid"]')!;
      await waitFor(() => input().value === '123456');
      expect(container!.querySelector('[role="alert"]')).toBeNull();
    },
  );
});
