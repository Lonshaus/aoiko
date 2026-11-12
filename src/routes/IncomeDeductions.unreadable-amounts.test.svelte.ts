import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { m } from '../paraglide/messages';
import type { Account } from '../db/types';

const { default: IncomeDeductions } = await import('./IncomeDeductions.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
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

function setYear(el: HTMLElement, year: string): void {
  const yearInput = el.querySelector<HTMLInputElement>('input[name="deductionNen"]')!;
  yearInput.value = year;
  yearInput.dispatchEvent(new Event('input', { bubbles: true }));
}

function saveButton(el: HTMLElement): HTMLButtonElement {
  return Array.from(el.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === m.income_deductions_save(),
  )!;
}

function type(el: HTMLElement, name: string, value: string): void {
  const input = el.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.accounts.bulkPut(ACCOUNTS_2026.map((a) => ({ ...a, year: 2026 }) as Account));
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

async function render(): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(IncomeDeductions, { target: container, props: {} });
  await waitFor(() => container!.querySelector('input[name="deductionNen"]') !== null);
  return container;
}

describe('所得控除画面：保存済みの金額を読めない・100 兆円以上のとき', () => {
  test('当年の費用明細が読めない：原文を出さず読み込み失敗の状態になり、保存できない', async () => {
    await db.journalEntries.add({
      id: 'bad',
      date: '2026-04-01',
      year: 2026,
      description: '壊れた経費',
      status: 'confirmed',
      source: 'manual',
      createdAt: 1,
      confirmedAt: 1,
    });
    await db.journalLines.bulkAdd(
      (['debit', 'credit'] as const).map((side) => ({
        id: `bad-${side}`,
        entryId: 'bad',
        side,
        accountCode: side === 'debit' ? '5150' : '1130',
        amount: side === 'debit' ? 'abc' : '1000',
        amountIndexed: '00000000000000.00',
        taxRate: 0,
        taxIncluded: true,
        invoiceCompliant: false,
      })),
    );
    const el = await render();
    setYear(el, '2026');
    await waitFor(() =>
      (el.textContent ?? '').includes(
        m.income_deductions_load_failed({ message: m.common_stored_amount_error() }),
      ),
    );
    expect(el.textContent).not.toContain('DecimalError');
    expect(saveButton(el).disabled).toBe(true);
    expect(el.textContent).toContain(m.income_deductions_load_failed_short());
  });

  test.each([
    ['1e3', () => m.common_amount_invalid()],
    ['100000000000000', () => m.common_amount_too_large()],
  ])(
    '金額欄に %j を入れると、その欄に誤りを示して保存できず、データを変えない',
    async (bad, message) => {
      const el = await render();
      setYear(el, '2026');
      await waitFor(() => !saveButton(el).disabled);
      type(el, 'socialInsurancePaid', bad);
      await waitFor(() =>
        (
          el.querySelector('input[name="socialInsurancePaid"]')!.parentElement?.textContent ?? ''
        ).includes(message()),
      );
      expect(saveButton(el).disabled).toBe(true);
      saveButton(el).click();
      await new Promise((r) => setTimeout(r, 100));
      expect(await db.personalDeductions.count()).toBe(0);
    },
  );

  test('保存されている記録に読めない欄があるときは、「保存されている次の欄を読めません。入力し直して保存してください：」に欄名を続けて示す', async () => {
    await db.personalDeductions.put({
      year: 2026,
      updatedAt: 1,
      socialInsurancePaid: 'abc',
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
    } as never);
    const el = await render();
    setYear(el, '2026');
    const expected = m.income_deductions_stored_invalid({
      fields: m.income_deductions_social_insurance_paid(),
    });
    await waitFor(() => (el.textContent ?? '').includes(expected));
    expect(saveButton(el).disabled).toBe(true);
  });

  test('保存済みの控除が 100 兆円以上なら、読み込んだ欄に誤りを示して保存を止める', async () => {
    await db.personalDeductions.put({
      year: 2026,
      updatedAt: 1,
      socialInsurancePaid: '100000000000000',
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
    } as never);
    const el = await render();
    setYear(el, '2026');
    await waitFor(() =>
      (
        el.querySelector('input[name="socialInsurancePaid"]')!.parentElement?.textContent ?? ''
      ).includes(m.common_amount_too_large()),
    );
    expect(el.textContent).toContain(m.income_deductions_invalid_count({ count: 1 }));
    expect(saveButton(el).disabled).toBe(true);
  });
});
