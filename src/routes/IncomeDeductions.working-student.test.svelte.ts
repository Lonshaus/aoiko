// 勤労学生控除は合計所得金額が上限以下のときだけ計上され、超えたときは理由の警告を出す。

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { newId } from '../lib/id';
import { toIndexable } from '../lib/decimal';
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

function checkboxByLabelText(el: HTMLElement, text: string): HTMLInputElement | null {
  const label = Array.from(el.querySelectorAll('label')).find((l) =>
    (l.textContent ?? '').includes(text),
  );
  return label?.querySelector('input[type="checkbox"]') ?? null;
}

async function checkWorkingStudent(el: HTMLElement): Promise<void> {
  const checkbox = checkboxByLabelText(el, '勤労学生に該当する');
  if (checkbox === null) {
    throw new Error('勤労学生のチェックボックスが見つからない');
  }
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
}

const TEST_ACCOUNTS: Account[] = [
  { code: '1130', year: 2026, name: '普通預金', category: 'asset', displayOrder: 130 },
  { code: '4110', year: 2026, name: '売上高', category: 'revenue', displayOrder: 110 },
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

describe('勤労学生控除の合計所得金額の条件', () => {
  test('説明文は常に表示される', async () => {
    const el = await render();
    setYear(el, 2026);
    await waitFor(() => (el.textContent ?? '').includes('保存'));
    expect(el.textContent).toContain('合計所得金額が89万円以下（令和7年分は85万円以下）');
  });

  test('合計所得金額が上限以下なら警告を出さない', async () => {
    const el = await render();
    setYear(el, 2026);
    await waitFor(() => (el.textContent ?? '').includes('保存'));
    await checkWorkingStudent(el);
    expect(el.textContent).not.toContain('勤労学生控除は適用されません');
  });

  test('合計所得金額が上限を超えると警告を出す', async () => {
    await db.accounts.bulkAdd(TEST_ACCOUNTS);
    await addBusinessRevenueEntry(2026, '5000000');
    const el = await render();
    setYear(el, 2026);
    await waitFor(() => (el.textContent ?? '').includes('保存'));
    await checkWorkingStudent(el);
    await waitFor(() => (el.textContent ?? '').includes('勤労学生控除は適用されません'));
    expect(el.textContent).toContain('合計所得金額が ¥890,000 を超えるため');
  });
});
