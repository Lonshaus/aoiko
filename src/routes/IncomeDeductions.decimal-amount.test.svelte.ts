import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mount, unmount } from 'svelte';
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

async function render(): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(IncomeDeductions, { target: container, props: {} });
  const el = container;
  await waitFor(() => el.querySelector('input[name="deductionNen"]') !== null);
  const yearInput = el.querySelector<HTMLInputElement>('input[name="deductionNen"]')!;
  yearInput.value = '2026';
  yearInput.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => {
    const save = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === m.income_deductions_save(),
    );
    return save !== undefined && !save.disabled;
  });
  const salaryLabel = Array.from(el.querySelectorAll('label')).find((l) =>
    (l.textContent ?? '').includes(m.income_deductions_salary_checkbox()),
  )!;
  salaryLabel.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
  await waitFor(() => el.querySelector('input[name="salaryPaidAmount"]') !== null);
  return el;
}

function type(el: HTMLElement, name: string, value: string): void {
  const input = el.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function errorUnder(el: HTMLElement, name: string): boolean {
  const input = el.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  return (input.parentElement?.textContent ?? '').includes(m.common_amount_invalid());
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

describe('所得控除画面の金額欄は円単位の整数だけを受け付ける', () => {
  test('給与収入に小数を入力すると欄の下に入力の誤りを表示し、整数に直すと消える', async () => {
    const el = await render();
    type(el, 'salaryPaidAmount', '100.5');
    await waitFor(() => errorUnder(el, 'salaryPaidAmount'));

    type(el, 'salaryPaidAmount', '100');
    await waitFor(() => !errorUnder(el, 'salaryPaidAmount'));
    expect(el.textContent).not.toContain(m.common_amount_invalid());
  });
});
