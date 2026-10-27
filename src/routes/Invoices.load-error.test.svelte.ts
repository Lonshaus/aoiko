import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { describeStorageError } from '../lib/storage-error';
import { m } from '../paraglide/messages';
import type { Invoice } from '../db/types';

const { default: Invoices } = await import('./Invoices.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

function draft(id: string, name: string): Invoice {
  return {
    id,
    documentType: 'invoice',
    status: 'draft',
    number: '',
    vendorId: '',
    date: '2026-08-03',
    lineItems: [{ id: `${id}-li`, name, quantity: '1', unitPrice: '1000', taxRate: 0.1 }],
    createdAt: 1_754_000_000_000,
  };
}

function button(c: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  await db.delete();
  await db.open();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  container?.remove();
  container = undefined;
  await db.delete();
});

describe('請求書一覧の読み込みに失敗したとき', () => {
  test('理由だけを示して空の一覧の文言を出さず、ほかの操作で消えず、読めたら戻る', async () => {
    const c = container!;
    const text = () => c.textContent ?? '';
    await db.invoices.add(draft('inv-1', '保守作業'));
    instance = mount(Invoices, { target: c, props: {} });
    await waitFor(() => button(c, m.invoices_action_edit()) !== undefined);

    const failure = new Error('一覧の読み込み失敗');
    // 読みに行った後で失敗させる。読まずに失敗すると liveQuery は以後の書き込みを監視しなくなる
    const original = db.invoices.toArray.bind(db.invoices);
    const spy = vi.spyOn(db.invoices, 'toArray').mockImplementation(() =>
      original().then(() => {
        throw failure;
      }),
    );
    await db.invoices.add(draft('inv-2', '設計作業'));
    await waitFor(() => text().includes(describeStorageError(failure)));
    expect(button(c, m.invoices_action_edit())).toBeUndefined();
    expect(text()).not.toContain(m.invoices_empty());

    button(c, m.invoices_action_new())!.click();
    await waitFor(() => button(c, m.settings_action_cancel()) !== undefined);
    button(c, m.settings_action_cancel())!.click();
    await waitFor(() => button(c, m.invoices_action_new()) !== undefined);
    expect(text()).toContain(describeStorageError(failure));
    expect(text()).not.toContain(m.invoices_empty());

    spy.mockRestore();
    await db.invoices.add(draft('inv-3', '保守作業2'));
    await waitFor(() => !text().includes(describeStorageError(failure)));
    await waitFor(
      () =>
        c.querySelectorAll('li').length === 3 && button(c, m.invoices_action_edit()) !== undefined,
    );
  });
});
