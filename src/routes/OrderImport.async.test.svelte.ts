import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { db } from '../db/db';
import { setLocale } from '../paraglide/runtime';
import { m } from '../paraglide/messages';
import { setSetting } from '../lib/settings';

const { gate } = vi.hoisted(() => ({
  gate: { resolve: null as null | (() => void), calls: 0, signals: [] as AbortSignal[] },
}));

vi.mock('../lib/order-extractor', () => ({
  createOrderExtractor: async () => ({
    external: false,
    destinationHost: '',
    extract: (_text: string, options?: { signal?: AbortSignal }) => {
      gate.calls += 1;
      if (options?.signal) {
        gate.signals.push(options.signal);
      }
      return new Promise((resolve) => {
        gate.resolve = () =>
          resolve({
            date: '2026-03-01',
            vendor: '非同期商店',
            items: [{ description: '品目A', amount: '9000' }],
            totalAmount: '9000',
          });
      });
    },
  }),
}));

const { default: OrderImport } = await import('./OrderImport.svelte');
const { orderDraft } = await import('../stores/order-draft.svelte');
const { analysis } = await import('../stores/analysis.svelte');

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  setLocale('ja', { reload: false });
  await db.delete();
  await db.open();
  await setSetting('skipExternalSendConfirm', true);
  gate.resolve = null;
  gate.calls = 0;
  gate.signals.length = 0;
});

afterEach(async () => {
  unmountOrder();
  orderDraft.reset();
  orderDraft.success = '';
  if (analysis.job !== null) {
    analysis.finish(analysis.job, 'cancelled');
  }
  analysis.unseen = {};
  analysis.notices = [];
  await db.delete();
});

function mountOrder(): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(OrderImport, { target: container, props: {} });
  flushSync();
  return container;
}

function unmountOrder(): void {
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  container?.remove();
  container = undefined;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

function findButton(c: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(c.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(label),
  );
}

function type(c: HTMLElement, text: string): void {
  const textarea = c.querySelector('textarea') as HTMLTextAreaElement;
  textarea.value = text;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

async function startAnalysis(c: HTMLElement): Promise<void> {
  type(c, '注文ページの貼り付けテキスト');
  findButton(c, m.order_analyze_button())!.click();
  await waitFor(() => gate.calls === 1);
  flushSync();
}

describe('OrderImport: 解析中に画面を離れる', () => {
  test('離れて戻っても、貼り付けた本文と解析結果が残っている', async () => {
    const first = mountOrder();
    await startAnalysis(first);
    unmountOrder();

    gate.resolve!();
    await waitFor(() => orderDraft.extracted !== null);
    expect(analysis.unseen.order).toBe('done');

    const second = mountOrder();
    expect((second.querySelector('textarea') as HTMLTextAreaElement).value).toBe(
      '注文ページの貼り付けテキスト',
    );
    expect(second.textContent).toContain(m.order_step_review());
    expect((second.querySelector('input[name="orderVendorTitle"]') as HTMLInputElement).value).toBe(
      '非同期商店',
    );
    expect(second.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(analysis.unseen.order).toBeUndefined();
  });

  test('解析の途中で戻ると、実行中の表示と取消しボタンが出る', async () => {
    const first = mountOrder();
    await startAnalysis(first);
    unmountOrder();
    const second = mountOrder();
    expect(findButton(second, m.order_analyze_running())).toBeDefined();
    expect(findButton(second, m.analysis_cancel())).toBeDefined();
    gate.resolve!();
    await waitFor(() => !analysis.busy);
  });
});

describe('OrderImport: 解析中の入力保護', () => {
  test('貼り付け欄は読み取り専用になり、入力しても本文は変わらない', async () => {
    const c = mountOrder();
    await startAnalysis(c);
    const textarea = c.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(true);
    type(c, '別の本文');
    expect(orderDraft.pastedText).toBe('注文ページの貼り付けテキスト');
    gate.resolve!();
    await waitFor(() => !analysis.busy);
  });
});

describe('OrderImport: 他の画面で解析中', () => {
  test('解析ボタンが無効になり、理由が出る', async () => {
    const c = mountOrder();
    type(c, '本文');
    const other = analysis.begin('receipt')!;
    flushSync();
    expect(findButton(c, m.order_analyze_button())!.disabled).toBe(true);
    expect(c.textContent).toContain(m.analysis_busy_other());
    analysis.finish(other, 'cancelled');
    flushSync();
    expect(findButton(c, m.order_analyze_button())!.disabled).toBe(false);
  });
});

describe('OrderImport: 取消し', () => {
  test('中止できない経路は「中止しています…」のまま待ち、終わると結果を捨てて再開できる', async () => {
    const c = mountOrder();
    await startAnalysis(c);
    findButton(c, m.analysis_cancel())!.click();
    flushSync();
    expect(gate.signals[0]?.aborted).toBe(true);
    expect(findButton(c, m.analysis_cancelling())!.disabled).toBe(true);
    expect(c.textContent).toContain(m.analysis_cancelling_hint());

    gate.resolve!();
    await waitFor(() => !analysis.busy);
    flushSync();
    expect(orderDraft.extracted).toBeNull();
    expect(c.textContent).not.toContain(m.order_step_review());
    expect(findButton(c, m.order_analyze_button())!.disabled).toBe(false);
    expect(c.querySelector('[class*="border-destructive"]')).toBeNull();
  });
});
