// 送信前確認の送信先は {@html} の訳文に埋め込まれる。URL として読めない設定値は
// そのまま表示されるため、文字として見えること・要素にならないことを確かめる。
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { setLocale } from '../paraglide/runtime';
import { setSetting } from '../lib/settings';
import { m } from '../paraglide/messages';

const { default: Receipt } = await import('./Receipt.svelte');

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(async () => {
  setLocale('ja', { reload: false });
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

describe('送信前確認の送信先', () => {
  test('HTML の文字列を設定しても要素を作らず、文字のまま表示する', async () => {
    const host = '<b id="inj">x</b>';
    await setSetting('skipAttachmentConfirm', true);
    await setSetting('receiptMethod', 'ai');
    await setSetting('aiEngine', 'openai-compatible');
    await setSetting('openaiOcrModel', 'vision');
    await setSetting('openaiBaseUrl', host);
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Receipt, { target: container, props: {} });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'receipt.png', { type: 'image/png' }));
    Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const analyzeButton = () =>
      Array.from(container!.querySelectorAll('button')).find((b) =>
        (b.textContent ?? '').includes('解析する'),
      );
    await waitFor(() => analyzeButton() !== undefined);
    flushSync();
    analyzeButton()!.click();
    await waitFor(() => (document.body.textContent ?? '').includes(m.cloud_send_confirm_title()));
    expect(document.querySelector('#inj')).toBeNull();
    expect(document.body.textContent).toContain(host);
  });
});
