import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';

const flag = vi.hoisted(() => ({ on: false }));
vi.mock('../lib/tax-reform-2027-ui', () => ({
  get TAX_REFORM_2027_UI() {
    return flag.on;
  },
}));

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
  await waitFor(() => el.querySelector('input[type="number"]') !== null);
  const input = el.querySelector('input[type="number"]') as HTMLInputElement;
  input.value = '2026';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => (el.textContent ?? '').includes('保存'));
  await new Promise((r) => setTimeout(r, 150));
  return el;
}

function field(el: HTMLElement, name: string): HTMLInputElement | null {
  return el.querySelector<HTMLInputElement>(`[name="${name}"]`);
}

async function store(business?: string, realEstate?: string): Promise<void> {
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
    ...(business === undefined ? {} : { priorPriorBusinessRevenue: business }),
    ...(realEstate === undefined ? {} : { priorPriorRealEstateRevenue: realEstate }),
  });
}

beforeEach(async () => {
  flag.on = false;
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

describe('前々年分の総収入金額の2欄は令和9年分以後の画面が出るまで隠す', () => {
  test('保存された値がなければ出ない', async () => {
    const el = await render();
    expect(field(el, 'priorPriorJigyoRevenue')).toBeNull();
    expect(field(el, 'priorPriorFudosanRevenue')).toBeNull();
  });

  test('保存された値が 5000000 なら出る', async () => {
    await store('5000000');
    const el = await render();
    expect(field(el, 'priorPriorJigyoRevenue')?.value).toBe('5000000');
    expect(field(el, 'priorPriorFudosanRevenue')).not.toBeNull();
  });

  test('保存された値が読めない文字列でも出る', async () => {
    await store(undefined, 'abc');
    const el = await render();
    expect(field(el, 'priorPriorFudosanRevenue')?.value).toBe('abc');
  });

  test('保存された値が 0 なら出ない', async () => {
    await store('0', '0');
    const el = await render();
    expect(field(el, 'priorPriorJigyoRevenue')).toBeNull();
    expect(field(el, 'priorPriorFudosanRevenue')).toBeNull();
  });

  test('出ている欄の値を 0 に直しても、欄は消えない', async () => {
    await store('5000000');
    const el = await render();
    const input = field(el, 'priorPriorJigyoRevenue')!;
    input.value = '0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
    expect(field(el, 'priorPriorJigyoRevenue')).not.toBeNull();
    expect(field(el, 'priorPriorFudosanRevenue')).not.toBeNull();
  });

  test('定数が true なら、保存された値がなくても出る', async () => {
    flag.on = true;
    const el = await render();
    expect(field(el, 'priorPriorJigyoRevenue')).not.toBeNull();
    expect(field(el, 'priorPriorFudosanRevenue')).not.toBeNull();
  });
});
