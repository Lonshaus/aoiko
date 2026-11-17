// 配偶者・扶養親族の障害の区分の保存・再読込、所得金額調整控除②の反映、および
// 税額の試算が .xtx 出力と同じ純関数（computeIncomeTax）に従うことを見る。

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

async function remount(): Promise<HTMLElement> {
  unmount(instance!);
  instance = undefined;
  container?.remove();
  container = undefined;
  return render();
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

function check(el: HTMLElement, text: string): void {
  const label = Array.from(el.querySelectorAll('label')).find((l) =>
    (l.textContent ?? '').includes(text),
  )!;
  const box = label.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
}

function choose(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function dependentSelect(el: HTMLElement): HTMLSelectElement | null {
  return el.querySelector<HTMLSelectElement>('select[name^="dependent-"][name$="-disability"]');
}

function estimate(el: HTMLElement, label: string): string | undefined {
  const p = Array.from(el.querySelectorAll('p')).find((x) =>
    (x.textContent ?? '').startsWith(label),
  );
  return p?.querySelector('span.font-mono')?.textContent ?? undefined;
}
// 結果欄は「項目名のspan」の直後に「金額のspan」が並ぶ
function resultValue(el: HTMLElement, label: string): string | undefined {
  const name = Array.from(el.querySelectorAll('span')).find((s) => s.textContent?.trim() === label);
  return name?.nextElementSibling?.textContent?.trim();
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

describe('配偶者・扶養親族の障害の区分', () => {
  test('保存して再読込しても保持され、障害者控除の金額も同じになる', async () => {
    const el = await render();
    check(el, m.income_deductions_spouse_checkbox());
    await waitFor(() => el.querySelector('select[name="spouseDisability"]') !== null);
    const addDependent = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === m.income_deductions_dependent_add(),
    )!;
    addDependent.click();
    await waitFor(() => dependentSelect(el) !== null);

    choose(el.querySelector<HTMLSelectElement>('select[name="spouseDisability"]')!, 'special');
    choose(dependentSelect(el)!, 'specialCohabiting');
    // 配偶者（特別障害者）40万円＋扶養親族（同居特別障害者）75万円
    await waitFor(
      () => resultValue(el, m.income_deductions_result_disability()) === formatJPY(1_150_000),
    );

    saveButton(el).click();
    await waitFor(() => (el.textContent ?? '').includes(m.income_deductions_saved()));
    const stored = await db.personalDeductions.get(2026);
    expect(stored?.spouse?.disability).toBe('special');
    expect(stored?.dependents[0]?.disability).toBe('specialCohabiting');

    const reloaded = await remount();
    await waitFor(
      () => reloaded.querySelector<HTMLSelectElement>('select[name="spouseDisability"]') !== null,
    );
    expect(
      reloaded.querySelector<HTMLSelectElement>('select[name="spouseDisability"]')!.value,
    ).toBe('special');
    expect(dependentSelect(reloaded)!.value).toBe('specialCohabiting');
    expect(resultValue(reloaded, m.income_deductions_result_disability())).toBe(
      formatJPY(1_150_000),
    );
  });

  test('障害の区分を持たない既存データを読み込むと「なし」で、障害者控除は0円', async () => {
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
      spouse: { totalIncome: '0', age: 40 },
      dependents: [{ id: 'd1', name: '子', age: 15, totalIncome: '0' }],
      updatedAt: 0,
    });
    const el = await render();
    await waitFor(() => dependentSelect(el) !== null);
    expect(el.querySelector<HTMLSelectElement>('select[name="spouseDisability"]')!.value).toBe(
      'none',
    );
    expect(dependentSelect(el)!.value).toBe('none');
    expect(resultValue(el, m.income_deductions_result_disability())).toBe(formatJPY(0));
  });
});

describe('所得金額調整控除②の反映', () => {
  test('給与収入100万円＋公的年金等30万円：合計所得金額は 16万円＋30万円', async () => {
    const el = await render();
    check(el, m.income_deductions_salary_checkbox());
    await waitFor(() => el.querySelector('input[name="salaryPaidAmount"]') !== null);
    type(el, 'salaryPaidAmount', '1000000');
    type(el, 'publicPensionAmount', '300000');
    // ②がなければ 26万円＋30万円＝56万円
    await waitFor(
      () => estimate(el, m.income_deductions_combined_total_income_label()) === formatJPY(460_000),
    );
  });
});

describe('税額の試算は .xtx 出力と同じ計算（外国税額控除・災害減免額・申告納税額の百円未満切捨て）', () => {
  test('試算欄の数字が computeIncomeTax と一致する', async () => {
    const el = await render();
    check(el, m.income_deductions_salary_checkbox());
    await waitFor(() => el.querySelector('input[name="salaryPaidAmount"]') !== null);
    type(el, 'salaryPaidAmount', '5000000');
    type(el, 'salaryWithholdingTax', '100000');
    type(el, 'foreignTaxCreditAmount', '10000');
    type(el, 'disasterExemptionAmount', '2000');

    const salary = salaryIncomeAmount(2026, D(5_000_000));
    const deductions = computeIncomeDeductions(2026, {
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
    const tax = computeIncomeTax(
      2026,
      salary.minus(deductions.total),
      { foreignTaxCreditAmount: D(10_000), disasterExemptionAmount: D(2_000) },
      D(100_000),
    );
    // 外国税額控除は復興特別所得税の後に引くため、旧計算（税額控除に含めて復興税を算定）とは異なる
    expect(tax.taxTotal.minus(10_000).minus(100_000).toString()).not.toBe(
      tax.filingTaxDue.toString(),
    );

    await waitFor(
      () =>
        resultValue(el, m.income_deductions_result_net_tax_due()) === formatJPY(tax.filingTaxDue),
    );
    expect(resultValue(el, m.income_deductions_result_income_tax())).toBe(
      formatJPY(tax.baseIncomeTax),
    );
    expect(resultValue(el, m.income_deductions_result_surtax())).toBe(
      formatJPY(tax.reconstructionSurtax),
    );
    expect(resultValue(el, m.income_deductions_result_final_tax())).toBe(formatJPY(tax.taxTotal));
  });
});
