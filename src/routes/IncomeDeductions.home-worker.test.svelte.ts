// 家内労働者等の特例（homeWorker）・前々年分収入・現金主義（cashBasisCache）の
// 新規入力が保存・再読込で保持されるか、および試算プレビューへ反映されるかを見る。

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { setSetting } from '../lib/settings';
import { newId } from '../lib/id';
import { D, formatJPY, toIndexable } from '../lib/decimal';
import { totalIncomeAmount } from '../tax-schema/2026/xtx-mapping-koa020';
import { buildPL } from '../domain/reports';
import type { Account, JournalLine } from '../db/types';

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
  await new Promise((r) => setTimeout(r, 80));
  return el;
}

function setYear(el: HTMLElement, year: number): void {
  const input = el.querySelector('input[type="number"]') as HTMLInputElement;
  input.value = String(year);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function findByLabelText(el: HTMLElement, text: string): HTMLElement | null {
  const label = Array.from(el.querySelectorAll('label')).find((l) =>
    (l.textContent ?? '').includes(text),
  );
  return label ?? null;
}

function checkboxByLabelText(el: HTMLElement, text: string): HTMLInputElement | null {
  return findByLabelText(el, text)?.querySelector('input[type="checkbox"]') ?? null;
}

function textInputByLabelText(el: HTMLElement, text: string): HTMLInputElement | null {
  const label = findByLabelText(el, text);
  return (label?.querySelector('input[type="text"]') ??
    label?.parentElement?.querySelector('input[type="text"]')) as HTMLInputElement | null;
}

function saveButton(el: HTMLElement): HTMLButtonElement | null {
  return Array.from(el.querySelectorAll('button')).find((b) => b.textContent === '保存') ?? null;
}

function businessIncomeText(el: HTMLElement): string | null {
  const p = Array.from(el.querySelectorAll('p')).find((p) =>
    (p.textContent ?? '').startsWith('事業所得'),
  );
  return p?.querySelector('span.font-mono')?.textContent ?? null;
}

const TEST_ACCOUNTS: Account[] = [
  { code: '1130', year: 2027, name: '普通預金', category: 'asset', displayOrder: 130 },
  { code: '4110', year: 2027, name: '売上高', category: 'revenue', displayOrder: 110 },
];

async function addBusinessRevenueEntry(year: number, amount: string): Promise<void> {
  const entryId = newId();
  const now = Date.now();
  await db.transaction('rw', [db.journalEntries, db.journalLines], async () => {
    await db.journalEntries.add({
      id: entryId,
      date: `${year}-05-01`,
      year,
      description: 'テスト売上',
      status: 'confirmed',
      source: 'manual',
      createdAt: now,
      confirmedAt: now,
    });
    const lines: JournalLine[] = [
      {
        id: newId(),
        entryId,
        side: 'debit',
        accountCode: '1130',
        amount,
        amountIndexed: toIndexable(amount),
        taxRate: 0,
        taxIncluded: true,
        invoiceCompliant: false,
      },
      {
        id: newId(),
        entryId,
        side: 'credit',
        accountCode: '4110',
        amount,
        amountIndexed: toIndexable(amount),
        taxRate: 0,
        taxIncluded: true,
        invoiceCompliant: false,
      },
    ];
    await db.journalLines.bulkAdd(lines);
  });
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

describe('homeWorker・前々年分収入の保存・再読込', () => {
  test('チェック・入力して保存すると、再読込後も同じ値が復元される', async () => {
    const el = await render();
    setYear(el, 2026);
    await waitFor(() => (el.textContent ?? '').includes('保存'));

    const homeWorkerCheckbox = checkboxByLabelText(el, '家内労働者等');
    if (homeWorkerCheckbox === null) {
      throw new Error('家内労働者等の特例チェックボックスが見つからない');
    }
    homeWorkerCheckbox.checked = true;
    homeWorkerCheckbox.dispatchEvent(new Event('change', { bubbles: true }));

    const revenueInput = textInputByLabelText(el, '前々年分の事業所得に係る総収入金額');
    if (revenueInput === null) {
      throw new Error('前々年分の事業所得に係る総収入金額の入力欄が見つからない');
    }
    revenueInput.value = '12000000';
    revenueInput.dispatchEvent(new Event('input', { bubbles: true }));

    const button = saveButton(el);
    if (button === null) {
      throw new Error('保存ボタンが見つからない');
    }
    button.click();
    await waitFor(() => (el.textContent ?? '').includes('保存しました'));

    const stored = await db.personalDeductions.get(2026);
    expect(stored?.homeWorker).toBe(true);
    expect(stored?.priorPriorBusinessRevenue).toBe('12000000');

    unmount(instance!);
    instance = undefined;
    container?.remove();
    container = undefined;
    const reloaded = await render();
    setYear(reloaded, 2026);
    await waitFor(() => (checkboxByLabelText(reloaded, '家内労働者等')?.checked ?? false) === true);
    expect(checkboxByLabelText(reloaded, '家内労働者等')?.checked).toBe(true);
    expect(textInputByLabelText(reloaded, '前々年分の事業所得に係る総収入金額')?.value).toBe(
      '12000000',
    );
  });

  test('前々年分の不動産所得に係る総収入金額も保存・再読込で保持される', async () => {
    const el = await render();
    setYear(el, 2026);
    await waitFor(() => (el.textContent ?? '').includes('保存'));

    const revenueInput = textInputByLabelText(el, '前々年分の不動産所得に係る総収入金額');
    if (revenueInput === null) {
      throw new Error('前々年分の不動産所得に係る総収入金額の入力欄が見つからない');
    }
    revenueInput.value = '5000000';
    revenueInput.dispatchEvent(new Event('input', { bubbles: true }));

    const button = saveButton(el);
    if (button === null) {
      throw new Error('保存ボタンが見つからない');
    }
    button.click();
    await waitFor(() => (el.textContent ?? '').includes('保存しました'));

    const stored = await db.personalDeductions.get(2026);
    expect(stored?.priorPriorRealEstateRevenue).toBe('5000000');

    unmount(instance!);
    instance = undefined;
    container?.remove();
    container = undefined;
    const reloaded = await render();
    setYear(reloaded, 2026);
    await waitFor(
      () =>
        textInputByLabelText(reloaded, '前々年分の不動産所得に係る総収入金額')?.value === '5000000',
    );
    expect(textInputByLabelText(reloaded, '前々年分の不動産所得に係る総収入金額')?.value).toBe(
      '5000000',
    );
  });

  test('給与所得の lastPaymentBeforeDecember（令和8年分のみ表示）も保存・再読込で保持される', async () => {
    const el = await render();
    setYear(el, 2026);
    await waitFor(() => (el.textContent ?? '').includes('保存'));

    const salaryCheckbox = checkboxByLabelText(el, '給与所得がある');
    if (salaryCheckbox === null) {
      throw new Error('給与所得のチェックボックスが見つからない');
    }
    salaryCheckbox.checked = true;
    salaryCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => checkboxByLabelText(el, '最後の給与等の支払日') !== null);

    const lastPaymentCheckbox = checkboxByLabelText(el, '最後の給与等の支払日');
    if (lastPaymentCheckbox === null) {
      throw new Error('lastPaymentBeforeDecember のチェックボックスが見つからない');
    }
    lastPaymentCheckbox.checked = true;
    lastPaymentCheckbox.dispatchEvent(new Event('change', { bubbles: true }));

    const button = saveButton(el);
    if (button === null) {
      throw new Error('保存ボタンが見つからない');
    }
    button.click();
    await waitFor(() => (el.textContent ?? '').includes('保存しました'));

    const stored = await db.personalDeductions.get(2026);
    expect(stored?.salaryIncome?.lastPaymentBeforeDecember).toBe(true);

    unmount(instance!);
    instance = undefined;
    container?.remove();
    container = undefined;
    const reloaded = await render();
    setYear(reloaded, 2026);
    await waitFor(
      () => (checkboxByLabelText(reloaded, '給与所得がある')?.checked ?? false) === true,
    );
    await waitFor(
      () => (checkboxByLabelText(reloaded, '最後の給与等の支払日')?.checked ?? false) === true,
    );
    expect(checkboxByLabelText(reloaded, '最後の給与等の支払日')?.checked).toBe(true);

    // 令和9年分では表示されない（附則13条2項の対象外）ことも合わせて見る。
    setYear(reloaded, 2027);
    await waitFor(
      () => (checkboxByLabelText(reloaded, '給与所得がある')?.checked ?? true) === false,
    );
    const salaryCheckbox2027 = checkboxByLabelText(reloaded, '給与所得がある');
    if (salaryCheckbox2027 === null) {
      throw new Error('給与所得のチェックボックスが見つからない（2027年分）');
    }
    salaryCheckbox2027.checked = true;
    salaryCheckbox2027.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    expect(checkboxByLabelText(reloaded, '最後の給与等の支払日')).toBeNull();
  });
});

describe('現金主義（cashBasisElection）が試算プレビューの事業所得に反映される', () => {
  test('電子・令和9年分・事業収入2,000,000でcashBasisElection=trueなら控除は10万（KOA020の事業所得と一致）', async () => {
    await db.accounts.bulkAdd(TEST_ACCOUNTS);
    await addBusinessRevenueEntry(2027, '2000000');
    await setSetting('aoiroDeductionKind', 'electronic');
    await setSetting('cashBasisElection', true);
    await setSetting('filingType', 'blue');
    const el = await render();
    setYear(el, 2027);
    await waitFor(() => businessIncomeText(el) !== null && businessIncomeText(el) !== '¥0');

    const pl = await buildPL(2027);
    // KOA020 側は同じ入力（cashBasis=true、事業所得のみ）で控除10万・事業所得190万になる。
    const expectedBusinessIncome = totalIncomeAmount({
      year: 2027,
      pl,
      filingType: 'blue',
      aoiroDeductionKind: 'electronic',
      cashBasis: true,
    });
    expect(expectedBusinessIncome.toString()).toBe('1900000');
    expect(businessIncomeText(el)).toBe(formatJPY(expectedBusinessIncome));
    expect(businessIncomeText(el)).toBe(formatJPY(D(1_900_000)));
  });
});
