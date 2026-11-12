import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ledger } from '../stores/ledger.svelte';
import { m } from '../paraglide/messages';
import JournalList from './JournalList.svelte';
import Home from './Home.svelte';

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const year = ledger.currentYear;
const month = String(new Date().getMonth() + 1).padStart(2, '0');

async function seed(id: string, description: string, debit: unknown, credit: unknown) {
  await db.journalEntries.add({
    id,
    date: `${year}-${month}-15`,
    year,
    description,
    status: 'confirmed',
    source: 'manual',
    createdAt: 1,
    confirmedAt: 1,
  });
  await db.journalLines.bulkAdd(
    (
      [
        ['debit', '5130', debit],
        ['credit', '1130', credit],
      ] as const
    ).map(([side, accountCode, amount]) => ({
      id: `${id}-${side}`,
      entryId: id,
      side,
      accountCode,
      amount: amount as string,
      amountIndexed: '00000000000000.00',
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
    })),
  );
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;
const text = () => container!.textContent ?? '';

function mountComponent(component: typeof JournalList | typeof Home): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(component, { target: container, props: {} });
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
  container?.remove();
  container = undefined;
  await db.delete();
});

describe('JournalList: 保存済みの金額を読めない仕訳', () => {
  test('一覧の合計と展開した行の両側に読めない金額の表示が出て、例外を投げない', async () => {
    await seed('bad-d', '借方が読めない', 'abc', '1000');
    await seed('bad-c', '貸方が読めない', '1000', 'abc');
    mountComponent(JournalList);
    await waitFor(() => text().includes('借方が読めない') && text().includes('貸方が読めない'));
    const unreadable = m.common_stored_amount_unreadable();
    expect(text().split(unreadable).length - 1).toBe(1);
    expect(text()).not.toContain('DecimalError');
    const rows = Array.from(container!.querySelectorAll<HTMLElement>('tbody > tr.cursor-pointer'));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      row.click();
      flushSync();
      await new Promise((r) => setTimeout(r, 50));
      expect(text().split(unreadable).length - 1).toBeGreaterThanOrEqual(2);
      expect(text()).not.toContain('DecimalError');
    }
  });

  test('小数の金額はそのまま表示する', async () => {
    await seed('half', '小数の仕訳', '0.5', '0.5');
    mountComponent(JournalList);
    await waitFor(() => text().includes('小数の仕訳'));
    expect(text()).toContain('¥0.5');
    expect(text()).not.toMatch(/¥1(?![\d,.])/);
  });

  test('金額の範囲で絞り込むと読めない明細の仕訳は一致せず、例外も出ない', async () => {
    await seed('bad-d', '借方が読めない', 'abc', 'abc');
    await seed('ok', '正常な仕訳', '1000', '1000');
    mountComponent(JournalList);
    await waitFor(() => text().includes('借方が読めない') && text().includes('正常な仕訳'));
    const min = container!.querySelector<HTMLInputElement>('input[name="filterAmountMin"]')!;
    min.value = '500';
    min.dispatchEvent(new Event('input', { bubbles: true }));
    min.dispatchEvent(new Event('blur'));
    flushSync();
    await waitFor(() => !text().includes('借方が読めない'));
    expect(text()).toContain('正常な仕訳');
    expect(text()).not.toContain('DecimalError');
    expect(ledger.lastError).toBeNull();
  });
});

describe('Home: 保存済みの金額を読めない仕訳', () => {
  test('直近の仕訳に読めない表示が出て、今月の合計は読めない件数を示す', async () => {
    await db.accounts.bulkPut([
      { code: '5130', year, name: '水道光熱費', category: 'expense', displayOrder: 1 },
      { code: '1130', year, name: '普通預金', category: 'asset', displayOrder: 2 },
    ]);
    await seed('bad-d', '借方が読めない', 'abc', '1000');
    await seed('ok', '正常な仕訳', '2000', '2000');
    mountComponent(Home);
    await waitFor(() => text().includes('借方が読めない') && text().includes('正常な仕訳'));
    expect(text()).toContain(m.common_stored_amount_unreadable());
    await waitFor(() => text().includes(m.home_overview_unreadable({ count: 1 })));
    expect(text()).not.toContain('DecimalError');
    expect(ledger.lastError).toBeNull();
  });
});
