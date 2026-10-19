import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { setSetting } from '../lib/settings';
import { addArApEntry } from '../domain/cash-flow';
import { m } from '../paraglide/messages';
import type { Account } from '../db/types';

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

function type(name: string, value: string, badInput = false): void {
  const el = named(name);
  // Firefox の type="number" はカンマ等を読めないとき value を '' にして badInput を立てる
  Object.defineProperty(el, 'validity', {
    configurable: true,
    value: { ...el.validity, badInput },
  });
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function cellText(name: string): string {
  return named(name).closest('td')?.textContent ?? '';
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

const settle = () => new Promise((r) => setTimeout(r, 50));

describe('予算の保存', () => {
  test('負の予算がある月は欄の下に入力の誤りを示し、どの月も保存せず保存済みも表示しない', async () => {
    await mountReports('budget-revenue-3');
    type('budget-keihi-1', '1000');
    type('budget-revenue-3', '-5000');
    expect(cellText('budget-revenue-3')).toContain(m.common_amount_invalid());
    expect(cellText('budget-keihi-1')).not.toContain(m.common_amount_invalid());

    buttonByText(m.reports_budget_save()).click();
    await settle();
    expect(await db.budgets.count()).toBe(0);
    expect(container!.textContent).not.toContain(m.settings_basic_saved());

    type('budget-revenue-3', '5000');
    expect(container!.textContent).not.toContain(m.common_amount_invalid());
    buttonByText(m.reports_budget_save()).click();
    await waitFor(async () => (await db.budgets.count()) === 12);
    const march = await db.budgets.where('[year+month]').equals([2026, 3]).first();
    expect(march?.revenueBudget).toBe('5000');
    const january = await db.budgets.where('[year+month]').equals([2026, 1]).first();
    expect(january?.expenseBudget).toBe('1000');
    await waitFor(() => (container!.textContent ?? '').includes(m.settings_basic_saved()));
  });

  test('読めない予算（ブラウザが空として渡した入力）も保存せず、その月の下に入力の誤りを示す', async () => {
    await mountReports('budget-keihi-7');
    type('budget-keihi-7', '', true);
    expect(cellText('budget-keihi-7')).toContain(m.common_amount_invalid());
    buttonByText(m.reports_budget_save()).click();
    await settle();
    expect(await db.budgets.count()).toBe(0);
    expect(container!.textContent).not.toContain(m.settings_basic_saved());
  });
});

describe('売掛金・買掛金の消込', () => {
  async function setup(): Promise<[string, string]> {
    await addArApEntry({
      type: 'receivable',
      description: 'A社',
      dueDate: '2026-11-30',
      originalAmount: '10000',
    });
    await addArApEntry({
      type: 'payable',
      description: 'B社',
      dueDate: '2026-12-31',
      originalAmount: '20000',
    });
    const [a, b] = await db.arApEntries.orderBy('dueDate').toArray();
    await mountReports(`arap-payment-${a!.id}`);
    return [a!.id, b!.id];
  }

  function recordButton(id: string): HTMLButtonElement {
    const btn = named(`arap-payment-${id}`).parentElement?.querySelector('button');
    if (btn === null || btn === undefined) {
      throw new Error('record button not found');
    }
    return btn;
  }

  test('負の額はその行の欄の下にだけ入力の誤りを示し、消込を記録しない', async () => {
    const [a, b] = await setup();
    type(`arap-payment-${a}`, '-5000');
    expect(cellText(`arap-payment-${a}`)).toContain(m.common_amount_invalid());
    expect(cellText(`arap-payment-${b}`)).not.toContain(m.common_amount_invalid());

    recordButton(a).click();
    await settle();
    expect((await db.arApEntries.get(a))!.paidAmount).toBe('0');

    type(`arap-payment-${a}`, '3000');
    expect(cellText(`arap-payment-${a}`)).not.toContain(m.common_amount_invalid());
    recordButton(a).click();
    await waitFor(async () => (await db.arApEntries.get(a))!.paidAmount === '3000');
  });

  test('読めない額（ブラウザが空として渡した入力）もその行に入力の誤りを示し、消込を記録しない', async () => {
    const [, b] = await setup();
    type(`arap-payment-${b}`, '', true);
    expect(cellText(`arap-payment-${b}`)).toContain(m.common_amount_invalid());
    recordButton(b).click();
    await settle();
    expect((await db.arApEntries.get(b))!.paidAmount).toBe('0');
  });
});
