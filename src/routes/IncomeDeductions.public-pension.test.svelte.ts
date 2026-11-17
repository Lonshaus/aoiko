import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { D, formatJPY } from '../lib/decimal';
import { m } from '../paraglide/messages';
import { hasUnsavedChanges } from '../router.svelte';
import { resolvePublicPensionIncome } from '../tax-schema/2026/other-income';
import type { PersonalDeductionInput } from '../db/types';

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

function saveButton(el: HTMLElement): HTMLButtonElement {
  return Array.from(el.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === m.income_deductions_save(),
  )!;
}

async function render(year: number): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(IncomeDeductions, { target: container, props: {} });
  const el = container;
  await waitFor(() => el.querySelector('input[name="deductionNen"]') !== null);
  const yearInput = el.querySelector<HTMLInputElement>('input[name="deductionNen"]')!;
  yearInput.value = String(year);
  yearInput.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => !saveButton(el).disabled);
  return el;
}

function close(): void {
  unmount(instance!);
  instance = undefined;
  container!.remove();
  container = undefined;
}

function named(el: HTMLElement, name: string): HTMLInputElement {
  return el.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
}

function type(el: HTMLElement, name: string, value: string): void {
  const input = named(el, name);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function radio(el: HTMLElement, value: string): HTMLInputElement {
  return el.querySelector<HTMLInputElement>(`input[name="publicPensionMode"][value="${value}"]`)!;
}

function estimate(el: HTMLElement, label: string): string | undefined {
  const p = Array.from(el.querySelectorAll('p')).find((x) =>
    (x.textContent ?? '').startsWith(label),
  );
  return p?.querySelector('span.font-mono')?.textContent ?? undefined;
}

const COMBINED_LABEL = () => m.income_deductions_combined_total_income_label();

function stored(
  year: number,
  overrides: Partial<PersonalDeductionInput> = {},
): PersonalDeductionInput {
  return {
    year,
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
    ...overrides,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  if (instance !== undefined) {
    close();
  }
  await db.delete();
});

describe('所得控除画面の公的年金等（収入金額から計算する方式）', () => {
  test('方式を切り替えて入力・保存すると計算方式の3項目だけが保存され、再読込で画面が戻る', async () => {
    const el = await render(2026);
    radio(el, 'revenue').click();
    await waitFor(() => named(el, 'publicPensionRevenue') !== null);
    expect(el.querySelector('input[name="publicPensionAmount"]')).toBeNull();
    type(el, 'publicPensionRevenue', '3000000');
    named(el, 'publicPensionAge65').click();

    const expected = formatJPY(
      resolvePublicPensionIncome(
        2026,
        { miscIncome: { publicPensionRevenue: D(3_000_000), publicPensionAge65OrOver: true } },
        D(0),
      ).amount,
    );
    expect(expected).toBe('¥1,900,000');
    await waitFor(
      () => el.querySelector('[data-testid="public-pension-computed"]')?.textContent === expected,
    );
    expect(estimate(el, COMBINED_LABEL())).toBe(expected);

    saveButton(el).click();
    await waitFor(() => (el.textContent ?? '').includes(m.income_deductions_saved()));
    const misc = (await db.personalDeductions.get(2026))?.miscIncome;
    expect(misc?.publicPensionInputMode).toBe('revenue');
    expect(misc?.publicPensionRevenue).toBe('3000000');
    expect(misc?.publicPensionAge65OrOver).toBe(true);
    expect(misc?.publicPensionAmount).toBeUndefined();
    close();

    const reloaded = await render(2026);
    await waitFor(() => named(reloaded, 'publicPensionRevenue')?.value === '3000000');
    expect(radio(reloaded, 'revenue').checked).toBe(true);
    expect(named(reloaded, 'publicPensionAge65').checked).toBe(true);
    expect(reloaded.querySelector('[data-testid="public-pension-computed"]')?.textContent).toBe(
      expected,
    );
  });

  test('切り替えても、もう一方の方式の入力値は画面に残り、保存されない', async () => {
    const el = await render(2026);
    type(el, 'publicPensionAmount', '300000');
    radio(el, 'revenue').click();
    await waitFor(() => named(el, 'publicPensionRevenue') !== null);
    radio(el, 'income').click();
    await waitFor(() => named(el, 'publicPensionAmount') !== null);
    expect(named(el, 'publicPensionAmount').value).toBe('300000');
  });

  test('確定額だけで保存された既存データは、読み込み後に未保存と判定されない', async () => {
    await db.personalDeductions.put(
      stored(2026, { miscIncome: { publicPensionAmount: '300000' } }),
    );
    const el = await render(2026);
    await waitFor(() => named(el, 'publicPensionAmount')?.value === '300000');
    flushSync();
    expect(radio(el, 'income').checked).toBe(true);
    expect(hasUnsavedChanges()).toBe(false);
  });

  test('計算方式・65歳以上・年金収入115万円・給与収入900万円：合計所得金額は令和9年分が730万円、令和8年分が705万円', async () => {
    const seed = (year: number) =>
      stored(year, {
        salaryIncome: { paidAmount: '9000000', withholdingTax: '0' },
        miscIncome: {
          publicPensionInputMode: 'revenue',
          publicPensionRevenue: '1150000',
          publicPensionAge65OrOver: true,
        },
      });
    await db.personalDeductions.put(seed(2027));
    await db.personalDeductions.put(seed(2026));

    const el2027 = await render(2027);
    await waitFor(() => estimate(el2027, COMBINED_LABEL()) === '¥7,300,000');
    close();

    const el2026 = await render(2026);
    await waitFor(() => estimate(el2026, COMBINED_LABEL()) === '¥7,050,000');
  });
});

describe('所得控除画面：令和9年分の直接入力方式の注意書き', () => {
  const hint = (el: HTMLElement) =>
    el.querySelector('[data-testid="public-pension-salary-cap-hint"]');
  const withSalary = { salaryIncome: { paidAmount: '3000000', withholdingTax: '0' } };

  test('令和9年分で給与収入があり直接入力方式なら表示する', async () => {
    await db.personalDeductions.put(stored(2027, withSalary));
    const el = await render(2027);
    await waitFor(() => hint(el) !== null);
    expect(hint(el)?.textContent).toContain(m.income_deductions_public_pension_salary_cap_hint());
  });

  test('令和8年分、給与収入が無い場合、計算方式の場合は表示しない', async () => {
    await db.personalDeductions.put(stored(2026, withSalary));
    await db.personalDeductions.put(stored(2027));
    const el2026 = await render(2026);
    await waitFor(() => named(el2026, 'publicPensionAmount') !== null);
    expect(hint(el2026)).toBeNull();
    close();

    const el2027 = await render(2027);
    await waitFor(() => named(el2027, 'publicPensionAmount') !== null);
    expect(hint(el2027)).toBeNull();
    close();

    await db.personalDeductions.put(
      stored(2027, {
        ...withSalary,
        miscIncome: { publicPensionInputMode: 'revenue', publicPensionRevenue: '1000000' },
      }),
    );
    const revenueMode = await render(2027);
    await waitFor(() => named(revenueMode, 'publicPensionRevenue') !== null);
    expect(hint(revenueMode)).toBeNull();
  });
});
