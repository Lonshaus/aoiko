import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { db } from '../db/db';
import { setLocale } from '../paraglide/runtime';
import { setSetting } from '../lib/settings';
import { m } from '../paraglide/messages';

vi.mock('../lib/receipt-extractor', () => ({
  createReceiptExtractor: async () => ({
    external: false,
    destinationHost: '',
    engine: 'gemini',
    extract: async () => ({
      date: '2026-05-01',
      vendorName: 'テスト商店',
      totalAmount: '2000',
      items: [],
    }),
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

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
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

async function analyze(c: HTMLElement): Promise<void> {
  const input = c.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['x'], 'receipt.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() =>
    Array.from(c.querySelectorAll('button')).some((b) => b.textContent?.includes('解析する')),
  );
  flushSync();
  button(c, '解析する').click();
  await waitFor(() => c.textContent?.includes('抽出結果') === true);
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

// ダイアログは AlertDialog の portal で document.body 直下に出る。
function bodyButton(label: string): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(label),
  );
  if (found === undefined) {
    throw new Error(`ボタンが見つからない: ${label}`);
  }
  return found;
}

function dispatchFileToInput(input: HTMLInputElement, file: File): void {
  const dt = new DataTransfer();
  dt.items.add(file);
  Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

function dispatchImageFile(c: HTMLElement, name: string): HTMLInputElement {
  const input = c.querySelector('input[type="file"]') as HTMLInputElement;
  dispatchFileToInput(input, new File(['x'], name, { type: 'image/png' }));
  return input;
}

// happy-dom は file input の value 代入を常に '' に固定し呼び出し自体を記録しないため、プロトタイプの setter に委譲するインスタンス直下の accessor で呼び出しを記録する。
function spyOnValueSetter(input: HTMLInputElement): string[] {
  const proto = Object.getPrototypeOf(input) as object;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (!desc?.get || !desc.set) {
    throw new Error('value のプロパティ記述子が取得できない');
  }
  const calls: string[] = [];
  Object.defineProperty(input, 'value', {
    configurable: true,
    get: () => desc.get!.call(input),
    set: (v: string) => {
      calls.push(v);
      desc.set!.call(input, v);
    },
  });
  return calls;
}

// ダイアログが閉じている間は AlertDialog の中身がポータルに存在しない前提のヘルパー
function dialogVisible(): boolean {
  return Array.from(document.body.querySelectorAll('button')).some((b) =>
    (b.textContent ?? '').includes(m.discard_candidates_discard()),
  );
}

describe('Receipt: 画像を選び直した時の破棄確認', () => {
  test('抽出結果がある状態で別画像を選ぶと確認ダイアログが出て、抽出結果は表示されたまま', async () => {
    const c = renderReceipt();
    await analyze(c);
    const preview = c.querySelector('img') as HTMLImageElement;
    const originalSrc = preview.src;

    dispatchImageFile(c, 'other.png');

    expect(dialogVisible()).toBe(true);
    expect(c.textContent).toContain('抽出結果');
    expect((c.querySelector('img') as HTMLImageElement).src).toBe(originalSrc);
  });

  test('ダイアログを閉じると抽出結果は残り、input.value がクリアされて同じ画像を選び直せる', async () => {
    const c = renderReceipt();
    await analyze(c);

    const input = c.querySelector('input[type="file"]') as HTMLInputElement;
    const otherFile = new File(['x'], 'other.png', { type: 'image/png' });
    dispatchFileToInput(input, otherFile);
    expect(dialogVisible()).toBe(true);

    const setCalls = spyOnValueSetter(input);
    bodyButton(m.discard_candidates_stay()).click();
    flushSync();

    expect(setCalls).toContain('');
    expect(c.textContent).toContain('抽出結果');

    // input.value が本当にクリアされていなければ、同じファイルの再選択はここで無視される
    dispatchFileToInput(input, otherFile);
    expect(dialogVisible()).toBe(true);
  });

  test('確認すると抽出結果は破棄され、新しい画像が読み込まれる', async () => {
    const c = renderReceipt();
    await analyze(c);
    const preview = c.querySelector('img') as HTMLImageElement;
    const originalSrc = preview.src;

    dispatchImageFile(c, 'other.png');
    bodyButton(m.discard_candidates_discard()).click();
    await waitFor(() => c.textContent?.includes('抽出結果') === false);

    expect((c.querySelector('img') as HTMLImageElement).src).not.toBe(originalSrc);
  });

  test('抽出結果が無ければ確認なしで即座に画像が読み込まれる', async () => {
    const c = renderReceipt();

    dispatchImageFile(c, 'first.png');
    await waitFor(() => c.querySelector('img') !== null);

    expect(dialogVisible()).toBe(false);
    expect(c.querySelector('img')).not.toBeNull();
  });
});

describe('Receipt: キャンセル時の破棄確認', () => {
  test('候補がある状態でキャンセルすると確認ダイアログが出て、候補は表示されたまま', async () => {
    const c = renderReceipt();
    await analyze(c);

    button(c, 'キャンセル').click();
    flushSync();

    expect(bodyButton(m.discard_candidates_discard())).not.toBeNull();
    expect(c.textContent).toContain('抽出結果');
  });

  test('ダイアログを閉じると候補は残ったまま', async () => {
    const c = renderReceipt();
    await analyze(c);

    button(c, 'キャンセル').click();
    flushSync();
    bodyButton(m.discard_candidates_stay()).click();
    flushSync();

    expect(c.textContent).toContain('抽出結果');
  });

  test('確認すると候補が破棄される', async () => {
    const c = renderReceipt();
    await analyze(c);

    button(c, 'キャンセル').click();
    flushSync();
    bodyButton(m.discard_candidates_discard()).click();
    flushSync();

    expect(c.textContent).not.toContain('抽出結果');
  });
});
