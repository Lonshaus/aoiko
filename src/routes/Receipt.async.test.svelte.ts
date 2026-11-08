import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { db } from '../db/db';
import { setLocale } from '../paraglide/runtime';
import { setSetting } from '../lib/settings';
import { receiptDraft } from '../stores/receipt-draft.svelte';
import { analysis } from '../stores/analysis.svelte';

const { gate } = vi.hoisted(() => ({
  gate: { resolve: null as null | (() => void), calls: 0, signals: [] as AbortSignal[] },
}));

vi.mock('../lib/receipt-extractor', () => ({
  createReceiptExtractor: async () => ({
    external: false,
    destinationHost: '',
    downscale: false,
    engine: 'apple-ai',
    extract: (_image: unknown, options?: { signal?: AbortSignal }) => {
      gate.calls += 1;
      if (options?.signal) {
        gate.signals.push(options.signal);
      }
      return new Promise((resolve) => {
        gate.resolve = () =>
          resolve({ date: '2026-05-01', vendorName: '非同期商店', totalAmount: '2000', items: [] });
      });
    },
  }),
}));

const { default: Receipt } = await import('./Receipt.svelte');

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  setLocale('ja', { reload: false });
  await db.delete();
  await db.open();
  await setSetting('skipAttachmentConfirm', true);
  await setSetting('skipExternalSendConfirm', true);
  gate.resolve = null;
  gate.calls = 0;
  gate.signals.length = 0;
});

afterEach(async () => {
  unmountReceipt();
  receiptDraft.reset();
  receiptDraft.success = '';
  if (analysis.job !== null) {
    analysis.finish(analysis.job, 'cancelled');
  }
  analysis.unseen = {};
  analysis.notices = [];
  // マウント時の設定読み込みが DB を閉じる前に終わるのを待つ。
  await new Promise((r) => setTimeout(r, 50));
  await db.delete();
});

function mountReceipt(): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Receipt, { target: container, props: {} });
  flushSync();
  return container;
}

function unmountReceipt(): void {
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

function pickFile(c: HTMLElement, name = 'receipt.png'): HTMLInputElement {
  const input = c.querySelector('input[type="file"]') as HTMLInputElement;
  const dt = new DataTransfer();
  dt.items.add(new File(['x'], name, { type: 'image/png' }));
  Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
  return input;
}

async function startAnalysis(c: HTMLElement): Promise<void> {
  pickFile(c);
  await waitFor(() => findButton(c, '解析する') !== undefined);
  findButton(c, '解析する')!.click();
  await waitFor(() => gate.calls === 1);
  flushSync();
}

describe('Receipt: 解析中に画面を離れる', () => {
  test('画面を離れて戻っても、解析の結果がそのまま表示され、確定できる状態になる', async () => {
    const first = mountReceipt();
    await startAnalysis(first);
    unmountReceipt();

    gate.resolve!();
    await waitFor(() => receiptDraft.extracted !== null);
    expect(analysis.unseen.receipt).toBe('done');

    const second = mountReceipt();
    expect(second.textContent).toContain('抽出結果');
    expect(
      (second.querySelector('input[name="receiptTotalAmount"]') as HTMLInputElement).value,
    ).toBe('2000');
    expect(second.querySelector('img')).not.toBeNull();
    expect(findButton(second, '仕訳を登録')).toBeDefined();
    expect(analysis.unseen.receipt).toBeUndefined();
  });

  test('解析の途中で戻ると、実行中の表示と取消しボタンがそのまま出る', async () => {
    const first = mountReceipt();
    await startAnalysis(first);
    unmountReceipt();

    const second = mountReceipt();
    expect(findButton(second, '解析中')).toBeDefined();
    expect(findButton(second, '解析を中止')).toBeDefined();
    gate.resolve!();
    await waitFor(() => receiptDraft.extracted !== null);
    flushSync();
    expect(second.textContent).toContain('抽出結果');
    expect(analysis.unseen.receipt).toBeUndefined();
  });
});

describe('Receipt: 解析中の入力保護', () => {
  test('解析中は画像の選択が無効になり、change が来ても受け付けない', async () => {
    const c = mountReceipt();
    await startAnalysis(c);
    const input = c.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    const before = receiptDraft.file;
    pickFile(c, 'other.png');
    expect(receiptDraft.file).toBe(before);
    gate.resolve!();
    await waitFor(() => receiptDraft.extracted !== null);
  });
});

describe('Receipt: 他の画面で解析中', () => {
  test('解析ボタンが無効になり、理由が出る', async () => {
    const c = mountReceipt();
    pickFile(c);
    await waitFor(() => findButton(c, '解析する') !== undefined);
    const other = analysis.begin('order')!;
    flushSync();
    expect(findButton(c, '解析する')!.disabled).toBe(true);
    expect(c.textContent).toContain('別の解析を実行中');
    analysis.finish(other, 'cancelled');
    flushSync();
    expect(findButton(c, '解析する')!.disabled).toBe(false);
  });
});

describe('Receipt: 取消し', () => {
  test('中止できないエンジンは「中止しています…」のまま待ち、終わると結果を捨てて再開できる', async () => {
    const c = mountReceipt();
    await startAnalysis(c);
    findButton(c, '解析を中止')!.click();
    flushSync();
    expect(gate.signals[0]?.aborted).toBe(true);
    const cancelling = findButton(c, '中止しています')!;
    expect(cancelling.disabled).toBe(true);
    expect(c.textContent).toContain('途中で止められない');
    expect(findButton(c, '解析中')?.disabled).toBe(true);

    gate.resolve!();
    await waitFor(() => !analysis.busy);
    flushSync();
    expect(receiptDraft.extracted).toBeNull();
    expect(c.textContent).not.toContain('抽出結果');
    expect(findButton(c, '解析する')!.disabled).toBe(false);
    expect(c.querySelector('[class*="border-destructive"]')).toBeNull();
  });
});
