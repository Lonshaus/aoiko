// 訂正仕訳（打消し側）には「訂正」ボタンを出さないことを見る。
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { toIndexable } from '../lib/decimal';
import { ledger } from '../stores/ledger.svelte';
import { m } from '../paraglide/messages';
import type { JournalEntry } from '../db/types';
import JournalList from './JournalList.svelte';

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function seed(entry: Pick<JournalEntry, 'id' | 'description'> & Partial<JournalEntry>) {
  const year = ledger.currentYear;
  await db.journalEntries.add({
    date: `${year}-${String(new Date().getMonth() + 1).padStart(2, '0')}-15`,
    year,
    status: 'confirmed',
    source: 'manual',
    createdAt: 1,
    confirmedAt: 1,
    ...entry,
  });
  await db.journalLines.bulkAdd(
    (['debit', 'credit'] as const).map((side) => ({
      id: `${entry.id}-${side}`,
      entryId: entry.id,
      side,
      accountCode: side === 'debit' ? '5130' : '1130',
      amount: '1000',
      amountIndexed: toIndexable('1000'),
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
    })),
  );
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seed({ id: 'orig', description: '原仕訳', status: 'reversed' });
  await seed({ id: 'rev', description: '[訂正] 原仕訳', originalEntryId: 'orig' });
  await seed({ id: 'plain', description: '通常の仕訳' });
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(JournalList, { target: container, props: {} });
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

async function expandRow(description: string): Promise<void> {
  await waitFor(() => (container!.textContent ?? '').includes(description));
  const row = Array.from(container!.querySelectorAll('tbody tr')).find((tr) =>
    (tr.textContent ?? '').includes(description),
  ) as HTMLElement;
  row.click();
  await new Promise((r) => setTimeout(r, 50));
}

function reverseButtons(): HTMLButtonElement[] {
  return Array.from(container!.querySelectorAll('button')).filter((b) =>
    (b.textContent ?? '').includes(m.journal_list_reverse_button()),
  );
}

function reversedLabels(): HTMLElement[] {
  return Array.from(container!.querySelectorAll<HTMLElement>('span')).filter(
    (el) => el.textContent?.trim() === m.journal_list_reversed_label(),
  );
}

describe('JournalList: 訂正ボタン', () => {
  test('通常の仕訳には訂正ボタンが出る', async () => {
    await expandRow('通常の仕訳');
    expect(reverseButtons()).toHaveLength(1);
  });

  test('訂正仕訳（originalEntryId あり）には訂正ボタンも訂正済み表示も出ない', async () => {
    await expandRow('[訂正] 原仕訳');
    expect(reverseButtons()).toHaveLength(0);
    expect(reversedLabels()).toHaveLength(0);
  });

  test('訂正された原仕訳には訂正ボタンの代わりに訂正済み表示が出る', async () => {
    await expandRow('原仕訳');
    expect(reverseButtons()).toHaveLength(0);
    expect(reversedLabels()).toHaveLength(1);
  });
});
