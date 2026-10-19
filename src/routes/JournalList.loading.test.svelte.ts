import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { toIndexable } from '../lib/decimal';
import { ledger } from '../stores/ledger.svelte';
import { m } from '../paraglide/messages';
import { describeStorageError } from '../lib/storage-error';
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

function mountList(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(JournalList, { target: container, props: {} });
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  vi.restoreAllMocks();
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

const loadingText = () => m.journal_list_loading();
const pagination = (total: number) => m.journal_list_pagination({ total, current: 1, pages: 1 });
const text = () => container!.textContent ?? '';

async function mountLoaded(total: number): Promise<void> {
  mountList();
  await waitFor(
    () =>
      text().includes(pagination(total).replace(/\s+/g, ' ')) || text().includes(pagination(total)),
  );
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 150));
}

function buttonByText(label: string): HTMLButtonElement {
  return Array.from(container!.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === label,
  ) as HTMLButtonElement;
}

function expectSettled(total: number): void {
  expect(text()).not.toContain(loadingText());
  expect(text()).toContain(pagination(total));
}

describe('JournalList: 読み込み状態', () => {
  test('金額欄を変更せずに blur しても読み込み中のままにならない', async () => {
    await seed({ id: 'a', description: '仕訳A' });
    await mountLoaded(1);
    const input = container!.querySelector<HTMLInputElement>('input[placeholder="0"]')!;
    input.dispatchEvent(new Event('blur'));
    await settle();
    expectSettled(1);
  });

  test('同じ年度を選び直しても読み込み中のままにならない', async () => {
    await seed({ id: 'a', description: '仕訳A' });
    await mountLoaded(1);
    const input = container!.querySelector<HTMLInputElement>('input[min="2020"]')!;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expectSettled(1);
  });

  test('初期状態でリセットしても読み込み中のままにならない', async () => {
    await seed({ id: 'a', description: '仕訳A' });
    await mountLoaded(1);
    buttonByText(m.journal_list_filter_reset()).click();
    await settle();
    expectSettled(1);
  });

  test('摘要欄を変更せずに blur しても読み込み中のままにならない', async () => {
    await seed({ id: 'a', description: '仕訳A' });
    await mountLoaded(1);
    container!
      .querySelector<HTMLInputElement>(
        `input[placeholder="${m.journal_list_filter_description_placeholder()}"]`,
      )!
      .dispatchEvent(new Event('blur'));
    await settle();
    expectSettled(1);
  });

  test('仕訳が 0 件でも変更なしのハンドラ後に空表示が残る', async () => {
    await mountLoaded(0);
    expect(text()).toContain(m.journal_list_empty());
    buttonByText(m.journal_list_filter_reset()).click();
    container!
      .querySelector<HTMLInputElement>('input[placeholder="0"]')!
      .dispatchEvent(new Event('blur'));
    await settle();
    expect(text()).not.toContain(loadingText());
    expect(text()).toContain(m.journal_list_empty());
  });

  test('実際に条件を変えると絞り込み結果と件数に切り替わる', async () => {
    await seed({ id: 'a', description: '文房具' });
    await seed({ id: 'b', description: '交通費' });
    await mountLoaded(2);
    const desc = container!.querySelector<HTMLInputElement>(
      `input[placeholder="${m.journal_list_filter_description_placeholder()}"]`,
    )!;
    desc.value = '文房具';
    desc.dispatchEvent(new Event('input', { bubbles: true }));
    desc.dispatchEvent(new Event('blur'));
    await waitFor(() => text().includes(pagination(1)));
    expect(text()).toContain('文房具');
    expect(text()).not.toContain('交通費');
    expect(text()).not.toContain(loadingText());
  });

  test('読み込みに失敗したら前の条件の行と件数を出さず、成功すると戻る', async () => {
    await seed({ id: 'a', description: '文房具' });
    await seed({ id: 'b', description: '交通費' });
    await mountLoaded(2);
    const failure = new Error('読み込み失敗');
    const spy = vi.spyOn(db.journalEntries, 'where').mockImplementation(() => {
      throw failure;
    });
    const desc = container!.querySelector<HTMLInputElement>(
      `input[placeholder="${m.journal_list_filter_description_placeholder()}"]`,
    )!;
    desc.value = '文房具';
    desc.dispatchEvent(new Event('input', { bubbles: true }));
    desc.dispatchEvent(new Event('blur'));
    await waitFor(() => text().includes(describeStorageError(failure)));
    expect(container!.querySelectorAll('tbody tr')).toHaveLength(0);
    expect(text()).not.toContain('交通費');
    expect(text()).not.toMatch(/\d+ 件/);
    expect(text()).not.toContain(m.journal_list_empty());
    expect(text()).not.toContain(loadingText());
    spy.mockRestore();
    desc.value = '';
    desc.dispatchEvent(new Event('input', { bubbles: true }));
    desc.dispatchEvent(new Event('blur'));
    await waitFor(() => text().includes(pagination(2)));
    expect(text()).toContain('交通費');
    expect(text()).not.toContain(describeStorageError(failure));
  });

  test('読み込みに失敗したら再読み込みで問い合わせ直し、成功すると戻る', async () => {
    await seed({ id: 'a', description: '文房具' });
    await seed({ id: 'b', description: '交通費' });
    await mountLoaded(2);
    const failure = new Error('読み込み失敗');
    const spy = vi.spyOn(db.journalEntries, 'where').mockImplementation(() => {
      throw failure;
    });
    const desc = container!.querySelector<HTMLInputElement>(
      `input[placeholder="${m.journal_list_filter_description_placeholder()}"]`,
    )!;
    desc.value = '文房具';
    desc.dispatchEvent(new Event('input', { bubbles: true }));
    desc.dispatchEvent(new Event('blur'));
    await waitFor(() => text().includes(describeStorageError(failure)));
    const callsBefore = spy.mock.calls.length;
    buttonByText(m.error_reload()).click();
    await waitFor(() => spy.mock.calls.length > callsBefore);
    await settle();
    expect(text()).not.toContain(loadingText());
    expect(container!.querySelectorAll('tbody tr')).toHaveLength(0);
    expect(text()).not.toMatch(/\d+ 件/);
    expect(text()).toContain(describeStorageError(failure));
    spy.mockRestore();
    buttonByText(m.error_reload()).click();
    await waitFor(() => text().includes(pagination(1)));
    expect(text()).toContain('文房具');
    expect(text()).not.toContain('交通費');
    expect(text()).not.toContain(describeStorageError(failure));
  });

  test('取引先一覧の読み込み失敗は件数を隠さず、再読み込みで一覧も読み直す', async () => {
    await seed({ id: 'a', description: '文房具' });
    await db.vendors.add({ id: 'v1', name: '取引先A' } as never);
    await mountLoaded(1);
    const failure = new Error('取引先の読み込み失敗');
    const spy = vi
      .spyOn(db.vendors, 'orderBy')
      .mockImplementation(() => ({ toArray: () => Promise.reject(failure) }) as never);
    await db.vendors.add({ id: 'v2', name: '取引先B' } as never);
    await waitFor(() => text().includes(describeStorageError(failure)));
    expect(text()).toContain(pagination(1));
    expect(container!.querySelectorAll('tbody tr')).toHaveLength(1);
    spy.mockRestore();
    buttonByText(m.error_reload()).click();
    await waitFor(() => text().includes('取引先B'));
    expect(text()).not.toContain(describeStorageError(failure));
    await db.vendors.add({ id: 'v3', name: '取引先C' } as never);
    await waitFor(() => text().includes('取引先C'));
  });

  test('仕訳と取引先一覧の両方が読み込みに失敗したら両方の失敗を出す', async () => {
    await seed({ id: 'a', description: '文房具' });
    await mountLoaded(1);
    const entryFailure = new Error('仕訳の読み込み失敗');
    const vendorFailure = new Error('取引先の読み込み失敗');
    vi.spyOn(db.vendors, 'orderBy').mockImplementation(
      () => ({ toArray: () => Promise.reject(vendorFailure) }) as never,
    );
    await db.vendors.add({ id: 'v1', name: '取引先A' } as never);
    await waitFor(() => text().includes(describeStorageError(vendorFailure)));
    vi.spyOn(db.journalEntries, 'where').mockImplementation(() => {
      throw entryFailure;
    });
    const desc = container!.querySelector<HTMLInputElement>(
      `input[placeholder="${m.journal_list_filter_description_placeholder()}"]`,
    )!;
    desc.value = '文房具';
    desc.dispatchEvent(new Event('input', { bubbles: true }));
    desc.dispatchEvent(new Event('blur'));
    await waitFor(() => text().includes(describeStorageError(entryFailure)));
    expect(text()).toContain(describeStorageError(vendorFailure));
  });
});
