import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { db } from '../db/db';
import { setLocale } from '../paraglide/runtime';
import type { OrderExtracted } from '../domain/order-extract';

const { state } = vi.hoisted(() => ({
  state: {
    extracted: {
      date: '2026-03-01',
      vendor: 'テスト商店',
      items: [{ description: '品目A', amount: '8200' }],
      totalAmount: '9000',
    } as OrderExtracted,
  },
}));

vi.mock('../lib/order-extractor', () => ({
  createOrderExtractor: async () => ({
    external: false,
    destinationHost: '',
    extract: async () => state.extracted,
  }),
}));

const { default: OrderImport } = await import('./OrderImport.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

function button(c: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(c.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(label),
  );
  if (found === undefined) {
    throw new Error(`ボタンが見つからない: ${label}`);
  }
  return found;
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  // 既定ロケールは実行環境で変わる。文言を確かめるので明示的に日本語へ固定する。
  setLocale('ja', { reload: false });
  await db.delete();
  await db.open();
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(OrderImport, { target: container, props: {} });
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

async function analyze(c: HTMLElement): Promise<void> {
  const textarea = c.querySelector('textarea') as HTMLTextAreaElement;
  textarea.value = '注文ページの貼り付けテキスト';
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  button(c, '解析').click();
  await waitFor(() => c.querySelector('table') !== null);
}

async function commit(c: HTMLElement): Promise<void> {
  button(c, '仕訳を登録').click();
  await new Promise((r) => setTimeout(r, 50));
  flushSync();
}

describe('OrderImport: 品目合計と総額の不一致', () => {
  test('一致しなければ登録せず、その場で理由を出す', async () => {
    const c = container as HTMLElement;
    await analyze(c);

    await commit(c);

    expect(c.textContent).toContain('品目合計と総額が一致しません');
    // 借方が品目・貸方が総額なので、続行させても validateLines が unbalanced を投げる。
    // 英語の例外メッセージが画面に出ていないことも確かめる。
    expect(c.textContent).not.toContain('unbalanced');
    expect(await db.journalEntries.count()).toBe(0);
  });

  test('一致していれば従来どおり登録できる', async () => {
    state.extracted = {
      date: '2026-03-01',
      vendor: 'テスト商店',
      items: [{ description: '品目A', amount: '9000' }],
      totalAmount: '9000',
    };
    const c = container as HTMLElement;
    await analyze(c);

    await commit(c);

    expect(c.textContent).not.toContain('品目合計と総額が一致しません');
    expect(await db.journalEntries.count()).toBe(1);
  });
});
