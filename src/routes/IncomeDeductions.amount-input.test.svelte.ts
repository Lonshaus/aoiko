import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { m } from '../paraglide/messages';
import { setSetting } from '../lib/settings';
import { ledger } from '../stores/ledger.svelte';

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

async function render(): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(IncomeDeductions, { target: container, props: {} });
  const el = container;
  await waitFor(() => el.querySelector('input[name="deductionNen"]') !== null);
  const yearInput = el.querySelector<HTMLInputElement>('input[name="deductionNen"]')!;
  yearInput.value = '2026';
  yearInput.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => !saveButton(el).disabled);
  return el;
}

function saveButton(el: HTMLElement): HTMLButtonElement {
  return Array.from(el.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === m.income_deductions_save(),
  )!;
}

function named(el: HTMLElement, name: string): HTMLInputElement {
  return el.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
}

function type(el: HTMLElement, name: string, value: string): void {
  const input = named(el, name);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function errorUnder(el: HTMLElement, name: string): boolean {
  return (named(el, name).parentElement?.textContent ?? '').includes(m.common_amount_invalid());
}

function estimate(el: HTMLElement, label: string): string | undefined {
  const p = Array.from(el.querySelectorAll('p')).find((x) =>
    (x.textContent ?? '').startsWith(label),
  );
  return p?.querySelector('span.font-mono')?.textContent ?? undefined;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
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
});

describe('所得控除画面の金額欄', () => {
  test('全角・カンマ付きで入力した公的年金等は値どおりに合計所得金額へ入り、入力のまま保存される', async () => {
    const el = await render();
    type(el, 'publicPensionAmount', '５，０００');
    const label = m.income_deductions_combined_total_income_label();
    await waitFor(() => estimate(el, label) === '¥5,000');
    expect(errorUnder(el, 'publicPensionAmount')).toBe(false);

    saveButton(el).click();
    await waitFor(() => (el.textContent ?? '').includes(m.income_deductions_saved()));
    const stored = await db.personalDeductions.get(2026);
    expect(stored?.miscIncome?.publicPensionAmount).toBe('５，０００');
  });

  test('負・読めない金額は欄の下に入力の誤りを表示し、試算では 0 として扱う', async () => {
    const el = await render();
    type(el, 'socialInsurancePaid', '-5000');
    await waitFor(() => errorUnder(el, 'socialInsurancePaid'));
    expect(el.textContent).not.toContain('-¥5,000');

    type(el, 'socialInsurancePaid', 'abc');
    await waitFor(() => errorUnder(el, 'socialInsurancePaid'));

    type(el, 'socialInsurancePaid', '５，０００');
    await waitFor(() => !errorUnder(el, 'socialInsurancePaid'));
    expect(el.textContent).toContain('¥5,000');
  });

  test('不動産所得の支払先明細でも、読めない金額は該当する欄の下に入力の誤りを表示する', async () => {
    await setSetting('realEstateIncomeEnabled', true);
    await waitFor(() => ledger.realEstateIncomeEnabled);
    const el = await render();
    const addButtons = Array.from(el.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === m.income_deductions_dependent_add(),
    );
    addButtons[0]!.click();
    await waitFor(() => el.querySelector('input[name$="-amount"][name^="fudosanRent-"]') !== null);
    const amount = el.querySelector<HTMLInputElement>(
      'input[name$="-amount"][name^="fudosanRent-"]',
    )!;
    const deductible = el.querySelector<HTMLInputElement>(
      'input[name$="-deductibleAmount"][name^="fudosanRent-"]',
    )!;

    type(el, amount.name, '-5000');
    await waitFor(() => errorUnder(el, amount.name));
    expect(errorUnder(el, deductible.name)).toBe(false);

    type(el, amount.name, '５，０００');
    type(el, deductible.name, '5,000円');
    await waitFor(() => errorUnder(el, deductible.name));
    expect(errorUnder(el, amount.name)).toBe(false);
  });
  test('負・読めない公的年金等は入力のまま保存され、再表示でも入力の誤りが出て、試算は未記入と同じになる', async () => {
    const label = m.income_deductions_combined_total_income_label();
    const blankEl = await render();
    const blankEstimate = estimate(blankEl, label);
    expect(blankEstimate).toBeDefined();
    unmount(instance!);
    instance = undefined;
    container!.remove();
    container = undefined;

    for (const bad of ['-5000', 'abc']) {
      const el = await render();
      type(el, 'publicPensionAmount', bad);
      saveButton(el).click();
      await waitFor(() => (el.textContent ?? '').includes(m.income_deductions_saved()));
      expect((await db.personalDeductions.get(2026))?.miscIncome?.publicPensionAmount).toBe(bad);
      unmount(instance!);
      instance = undefined;
      container!.remove();
      container = undefined;

      const reloaded = await render();
      await waitFor(() => named(reloaded, 'publicPensionAmount').value === bad);
      expect(errorUnder(reloaded, 'publicPensionAmount')).toBe(true);
      expect(estimate(reloaded, label)).toBe(blankEstimate);
      unmount(instance!);
      instance = undefined;
      container!.remove();
      container = undefined;
    }
  });

  test('公的年金等が空欄・0（全角の 0 を含む）なら保存されない', async () => {
    for (const zero of ['', '0', '０']) {
      const el = await render();
      type(el, 'publicPensionAmount', zero);
      saveButton(el).click();
      await waitFor(() => (el.textContent ?? '').includes(m.income_deductions_saved()));
      const stored = await db.personalDeductions.get(2026);
      expect(stored?.miscIncome).toBeDefined();
      expect(stored?.miscIncome?.publicPensionAmount).toBeUndefined();
      unmount(instance!);
      instance = undefined;
      container!.remove();
      container = undefined;
    }
  });

  test('支払先明細の金額が文字列以外で保存されていても画面は表示される', async () => {
    await setSetting('realEstateIncomeEnabled', true);
    await waitFor(() => ledger.realEstateIncomeEnabled);
    await db.personalDeductions.put({
      year: 2026,
      updatedAt: Date.now(),
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
      realEstateIncome: {
        businessScale: false,
        landLoanInterestAmount: '0',
        rentPaid: [{ payeeName: '地主', amount: 600000 }],
      },
    } as never);
    const el = await render();
    await waitFor(() => el.querySelector('input[name$="-amount"][name^="fudosanRent-"]') !== null);
    expect(el.textContent).not.toContain('予期しないエラー');
  });
});
