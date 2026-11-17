// 令和9年分（2027）から防衛特別所得税の行と三税の合計ラベルが出ること、
// 令和8年分（2026）以前の表示は変わらないことを見る。

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { m } from '../paraglide/messages';
import { D, formatJPY } from '../lib/decimal';
import { computeIncomeDeductions, computeIncomeTax } from '../tax-schema/2026/income-deductions';
import { salaryIncomeAmount } from '../tax-schema/2026/other-income';

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

async function render(year: number): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(IncomeDeductions, { target: container, props: {} });
  const el = container;
  await waitFor(() => el.querySelector('input[name="deductionNen"]') !== null);
  const yearInput = el.querySelector<HTMLInputElement>('input[name="deductionNen"]')!;
  yearInput.value = String(year);
  yearInput.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => {
    const save = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === m.income_deductions_save(),
    );
    return save !== undefined && !save.disabled;
  });
  return el;
}

function type(el: HTMLElement, name: string, value: string): void {
  const input = el.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function check(el: HTMLElement, text: string): void {
  const label = Array.from(el.querySelectorAll('label')).find((l) =>
    (l.textContent ?? '').includes(text),
  )!;
  const box = label.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
}
// 結果欄は「項目名のspan」の直後に「金額のspan」が並ぶ
function resultValue(el: HTMLElement, label: string): string | undefined {
  const name = Array.from(el.querySelectorAll('span')).find((s) => s.textContent?.trim() === label);
  return name?.nextElementSibling?.textContent?.trim();
}

function hasLabel(el: HTMLElement, label: string): boolean {
  return Array.from(el.querySelectorAll('span')).some((s) => s.textContent?.trim() === label);
}

async function enterSalary(el: HTMLElement): Promise<void> {
  check(el, m.income_deductions_salary_checkbox());
  await waitFor(() => el.querySelector('input[name="salaryPaidAmount"]') !== null);
  type(el, 'salaryPaidAmount', '5000000');
  type(el, 'salaryWithholdingTax', '100000');
}

function expectedTax(year: number) {
  const salary = salaryIncomeAmount(year, D(5_000_000));
  const deductions = computeIncomeDeductions(year, {
    totalIncome: salary,
    socialInsurancePaid: D(0),
    smallBusinessMutualAidPaid: D(0),
    lifeInsurance: {},
    earthquakeInsurancePaid: D(0),
    oldLongTermInsurancePaid: D(0),
    medicalExpensePaid: D(0),
    medicalInsuranceReimbursement: D(0),
    donationAmount: D(0),
    casualtyLossDeduction: D(0),
    isDisabled: false,
    isSpecialDisabled: false,
    isSingleParent: false,
    isWidow: false,
    isWorkingStudent: false,
    dependents: [],
  });
  return computeIncomeTax(year, salary.minus(deductions.total), {}, D(100_000));
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

describe('税額の試算：防衛特別所得税', () => {
  test('令和9年分は防衛特別所得税の行と三税の合計ラベルを出し、数字は computeIncomeTax と一致する', async () => {
    const el = await render(2027);
    await enterSalary(el);
    const tax = expectedTax(2027);
    expect(tax.defenseSurtax.greaterThan(0)).toBe(true);

    await waitFor(
      () =>
        resultValue(el, m.income_deductions_result_net_tax_due()) === formatJPY(tax.filingTaxDue),
    );
    expect(resultValue(el, m.income_deductions_result_surtax())).toBe(
      formatJPY(tax.reconstructionSurtax),
    );
    expect(resultValue(el, m.income_deductions_result_defense_surtax())).toBe(
      formatJPY(tax.defenseSurtax),
    );
    expect(resultValue(el, m.income_deductions_result_tax_total_with_defense())).toBe(
      formatJPY(tax.taxTotal),
    );
    expect(hasLabel(el, m.income_deductions_result_final_tax())).toBe(false);
  });

  test('令和8年分は防衛特別所得税の行を出さず、合計ラベルも従来のまま', async () => {
    const el = await render(2026);
    await enterSalary(el);
    const tax = expectedTax(2026);

    await waitFor(
      () =>
        resultValue(el, m.income_deductions_result_net_tax_due()) === formatJPY(tax.filingTaxDue),
    );
    expect(resultValue(el, m.income_deductions_result_final_tax())).toBe(formatJPY(tax.taxTotal));
    expect(hasLabel(el, m.income_deductions_result_defense_surtax())).toBe(false);
    expect(hasLabel(el, m.income_deductions_result_tax_total_with_defense())).toBe(false);
  });
});
