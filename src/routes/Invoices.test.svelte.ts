import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
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

function draft(): Invoice {
  return {
    id: 'inv-1',
    documentType: 'invoice',
    status: 'draft',
    number: '',
    vendorId: '',
    date: '2026-08-03',
    lineItems: [{ id: 'li-1', name: '保守作業', quantity: '1', unitPrice: '1000', taxRate: 0.1 }],
    createdAt: 1_754_000_000_000,
  };
}
// ロケールはテスト環境の既定（英語）になるため、ラベルは messages 経由で引く。
function button(c: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
}

function itemNames(c: HTMLElement): string[] {
  return Array.from(
    c.querySelectorAll<HTMLInputElement>(`input[placeholder="${m.invoices_form_item_name()}"]`),
  ).map((el) => el.value);
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

describe('Invoices: 下書きの編集を開く', () => {
  // 一覧は $state 配列で保持しているため要素は proxy。structuredClone で複製しようとすると
  // DataCloneError で落ち、編集フォームが開かないままエラーバナーだけ出ていた。
  test('編集を押すと、その下書きの内容が入ったフォームが開く', async () => {
    await db.invoices.add(draft());
    const c = container as HTMLElement;
    instance = mount(Invoices, { target: c, props: {} });

    await waitFor(() => button(c, m.invoices_action_edit()) !== undefined);
    button(c, m.invoices_action_edit())?.click();

    await waitFor(() => button(c, m.invoices_action_issue()) !== undefined);
    expect(itemNames(c)).toEqual(['保守作業']);
  });

  test('編集フォームでの変更は、保存するまで保管中の下書きに触れない', async () => {
    await db.invoices.add(draft());
    const c = container as HTMLElement;
    instance = mount(Invoices, { target: c, props: {} });

    await waitFor(() => button(c, m.invoices_action_edit()) !== undefined);
    button(c, m.invoices_action_edit())?.click();
    await waitFor(() => button(c, m.invoices_action_issue()) !== undefined);

    const nameInput = c.querySelector<HTMLInputElement>(
      `input[placeholder="${m.invoices_form_item_name()}"]`,
    );
    if (nameInput === null) {
      throw new Error('明細の品名欄が見つかりません');
    }
    nameInput.value = '書き換え';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    button(c, m.settings_action_cancel())?.click();
    await waitFor(() => button(c, m.invoices_action_edit()) !== undefined);
    const stored = await db.invoices.get('inv-1');
    expect(stored?.lineItems[0]?.name).toBe('保守作業');
  });
});
