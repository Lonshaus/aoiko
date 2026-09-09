import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { db } from '../db/db';
import { setLocale } from '../paraglide/runtime';
import { setSetting } from '../lib/settings';

const { bridgeState, extractorCalls } = vi.hoisted(() => ({
  bridgeState: { available: true },
  extractorCalls: [] as Array<[string, string]>,
}));

vi.mock('../lib/native-bridge', () => ({
  nativeBridge: () => ({
    isTextRecognitionAvailable: async () => bridgeState.available,
  }),
}));

vi.mock('../lib/receipt-extractor', () => ({
  createReceiptExtractor: async (method: string, ruleEngine: string) => {
    extractorCalls.push([method, ruleEngine]);
    return {
      external: false,
      destinationHost: '',
      engine: ruleEngine,
      extract: async () => ({
        date: '2026-03-01',
        vendorName: 'テスト商店',
        totalAmount: '1000',
        items: [],
      }),
    };
  },
}));

const { default: Receipt } = await import('./Receipt.svelte');

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  setLocale('ja', { reload: false });
  await db.delete();
  await db.open();
  bridgeState.available = true;
  extractorCalls.length = 0;
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

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

function renderReceipt(): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Receipt, { target: container, props: {} });
  return container;
}

async function selectFile(c: HTMLElement): Promise<void> {
  const input = c.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['x'], 'receipt.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => c.querySelector('button') !== null);
  flushSync();
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

describe('Receipt: エンジン選択', () => {
  test('native 利用可：規則エンジン選択で select が現れ、2 択', async () => {
    await setSetting('skipAttachmentConfirm', true);
    await setSetting('receiptMethod', 'rule');
    const c = renderReceipt();
    await selectFile(c);
    button(c, '内蔵の規則エンジン').click();
    flushSync();
    await waitFor(() => c.querySelector('select') !== null);
    const options = c.querySelectorAll('select option');
    expect(options.length).toBe(2);
  });

  test('native 利用不可：stored=native でも select は出ず、tesseract で解析される', async () => {
    bridgeState.available = false;
    await setSetting('skipAttachmentConfirm', true);
    await setSetting('receiptMethod', 'rule');
    await setSetting('receiptRuleEngine', 'native');
    const c = renderReceipt();
    await selectFile(c);
    await waitFor(async () => (await db.settings.get('receiptRuleEngine'))?.value === 'tesseract');
    flushSync();
    expect(c.querySelector('select')).toBeNull();

    button(c, '解析する').click();
    await waitFor(() => extractorCalls.length > 0);
    expect(extractorCalls[0]).toEqual(['rule', 'tesseract']);
  });

  test('AI 行は aiEngine を反映する（openai-compatible）', async () => {
    await setSetting('skipAttachmentConfirm', true);
    await setSetting('aiEngine', 'openai-compatible');
    await setSetting('receiptMethod', 'ai');
    const c = renderReceipt();
    await selectFile(c);
    await waitFor(() => c.textContent?.includes('OpenAI') === true);
    expect(c.textContent).toContain('OpenAI');
  });

  test('セグメント切替は即座に設定へ書き込まれる（往復確認）', async () => {
    await setSetting('skipAttachmentConfirm', true);
    const c = renderReceipt();
    await selectFile(c);
    button(c, '内蔵の規則エンジン').click();
    await waitFor(async () => (await db.settings.get('receiptMethod'))?.value === 'rule');
    expect((await db.settings.get('receiptMethod'))?.value).toBe('rule');

    await waitFor(() => c.querySelector('select') !== null);
    const select = c.querySelector('select') as HTMLSelectElement;
    select.value = 'tesseract';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(async () => (await db.settings.get('receiptRuleEngine'))?.value === 'tesseract');
    expect((await db.settings.get('receiptRuleEngine'))?.value).toBe('tesseract');
  });
});
