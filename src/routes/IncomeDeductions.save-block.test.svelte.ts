import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { m } from '../paraglide/messages';

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

function button(el: HTMLElement, label: string): HTMLButtonElement {
  return Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)!;
}

async function render(): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(IncomeDeductions, { target: container, props: {} });
  const el = container;
  await waitFor(() => el.querySelector('input[name="deductionNen"]') !== null);
  const yearInput = el.querySelector<HTMLInputElement>('input[name="deductionNen"]')!;
  yearInput.value = '2026';
  yearInput.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => !button(el, m.income_deductions_save()).disabled);
  return el;
}

function addButtonUnder(el: HTMLElement, title: string): HTMLButtonElement {
  const heading = Array.from(el.querySelectorAll('h4')).find((h) => h.textContent === title)!;
  return heading.parentElement!.querySelector('button')!;
}

function type(el: HTMLElement, selector: string, value: string): void {
  const input = el.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
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

async function saveBlocked(el: HTMLElement): Promise<void> {
  const save = button(el, m.income_deductions_save());
  await waitFor(() => save.disabled);
  save.click();
  await new Promise((r) => setTimeout(r, 50));
  expect(await db.personalDeductions.get(2026)).toBeUndefined();
  expect(el.textContent).not.toContain(m.income_deductions_saved());
}

describe('所得控除の保存前の検査', () => {
  test.each(['abc', '-5000', '1e3'])('社会保険料 %j は保存されず、件数が出る', async (bad) => {
    const el = await render();
    type(el, 'input[name="socialInsurancePaid"]', bad);
    expect(el.textContent).toContain(m.income_deductions_invalid_count({ count: 1 }));
    await saveBlocked(el);
  });

  test('読める値に直すと保存できる', async () => {
    const el = await render();
    type(el, 'input[name="socialInsurancePaid"]', 'abc');
    type(el, 'input[name="socialInsurancePaid"]', '５，０００');
    const save = button(el, m.income_deductions_save());
    await waitFor(() => !save.disabled);
    save.click();
    await waitFor(() => (el.textContent ?? '').includes(m.income_deductions_saved()));
    expect((await db.personalDeductions.get(2026))?.socialInsurancePaid).toBe('５，０００');
  });

  test.each(['200', '', '2.5'])('扶養親族の年齢 %j は保存されない', async (bad) => {
    const el = await render();
    addButtonUnder(el, m.income_deductions_dependents_title()).click();
    flushSync();
    type(el, 'input[name$="-age"][name^="dependent-"]', bad);
    expect(el.textContent).toContain(m.common_integer_invalid({ min: 0, max: 120 }));
    await saveBlocked(el);
  });

  test.each(['13', '-1', ''])('事業専従者の従事月数 %j は保存されない', async (bad) => {
    const el = await render();
    addButtonUnder(el, m.income_deductions_family_employees_title()).click();
    flushSync();
    type(el, 'input[name$="-monthsWorked"]', bad);
    expect(el.textContent).toContain(m.common_integer_invalid({ min: 0, max: 12 }));
    await saveBlocked(el);
  });

  test('範囲内の年齢と月数は保存できる', async () => {
    const el = await render();
    addButtonUnder(el, m.income_deductions_family_employees_title()).click();
    flushSync();
    type(el, 'input[name$="-monthsWorked"]', '6');
    type(el, 'input[name^="familyEmployee-"][name$="-age"]', '45');
    const save = button(el, m.income_deductions_save());
    await waitFor(() => !save.disabled);
    save.click();
    await waitFor(() => (el.textContent ?? '').includes(m.income_deductions_saved()));
    const stored = await db.personalDeductions.get(2026);
    expect(stored?.familyEmployees?.[0]?.monthsWorked).toBe(6);
    expect(stored?.familyEmployees?.[0]?.age).toBe(45);
  });
});

describe('保存済みの所得控除を読めないとき', () => {
  async function renderStored(stored: Record<string, unknown>): Promise<HTMLElement> {
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
      updatedAt: 1,
      ...stored,
    } as never);
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(IncomeDeductions, { target: container, props: {} });
    const el = container;
    await waitFor(() => el.querySelector('input[name="deductionNen"]') !== null);
    const yearInput = el.querySelector<HTMLInputElement>('input[name="deductionNen"]')!;
    yearInput.value = '2026';
    yearInput.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => el.querySelector('[role="alert"]') !== null);
    return el;
  }

  test('lifeInsurance が無く dependents が配列でない記録でも画面は落ちず、欄の名前を示す', async () => {
    const el = await renderStored({ lifeInsurance: undefined, dependents: 'x' });
    expect(el.textContent).toContain(m.income_deductions_insurance_title());
    expect(el.textContent).toContain(m.income_deductions_dependents_title());
  });

  test('数値で保存された社会保険料は件数に数えて保存させない', async () => {
    const el = await renderStored({ socialInsurancePaid: 5000 });
    expect(el.textContent).toContain(m.income_deductions_social_insurance_paid());
    expect(button(el, m.income_deductions_save()).disabled).toBe(true);
  });

  test('文字列で保存された扶養親族の年齢は件数に数えて保存させない', async () => {
    const el = await renderStored({
      dependents: [{ id: 'd1', name: '子', age: '40', totalIncome: '0' }],
    });
    expect(el.textContent).toContain(m.income_deductions_dependent_age());
    expect(button(el, m.income_deductions_save()).disabled).toBe(true);
  });
});
