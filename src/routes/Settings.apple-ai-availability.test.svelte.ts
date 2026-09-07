// 理由コード（0..5）ごとに選択肢の出し分けが正しいかを見る。1/4 は利用者側で
// どうにもならないので隠す、2/3/5 は選び直せるので disabled のまま理由だけ出す。
// __NATIVE__ は vitest.config.ts で true に固定されているので、実際の DOM で確かめられる。

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';

const { default: Settings } = await import('./Settings.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function stubAppleAiAvailability(resolve: number | null): void {
  const appleAiAvailability = resolve === null ? undefined : vi.fn().mockResolvedValue(resolve);
  vi.stubGlobal('window', Object.assign(window, { __aoikoNative: { appleAiAvailability } }));
}

async function renderSettings(): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Settings, { target: container, props: {} });
  const el = container;
  await waitFor(() => el.querySelector('select') !== null);
  return el;
}

function findOption(el: HTMLElement): HTMLOptionElement | null {
  return el.querySelector('option[value="apple-ai"]');
}

beforeEach(async () => {
  await db.delete();
  await db.open();
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
  vi.unstubAllGlobals();
  await db.delete();
});

describe('OS 内蔵の AI: 選択肢の出し分け', () => {
  test('code 0（使える）: 選べる選択肢が出る', async () => {
    stubAppleAiAvailability(0);
    const el = await renderSettings();
    await waitFor(() => findOption(el) !== null);
    const option = findOption(el);
    expect(option).not.toBeNull();
    expect(option?.disabled).toBe(false);
  });

  test('code 1（機種非対応）: 選択肢が出ない', async () => {
    stubAppleAiAvailability(1);
    const el = await renderSettings();
    await new Promise((r) => setTimeout(r, 50));
    expect(findOption(el)).toBeNull();
  });

  test('code 4（OS が古い）: 選択肢が出ない', async () => {
    stubAppleAiAvailability(4);
    const el = await renderSettings();
    await new Promise((r) => setTimeout(r, 50));
    expect(findOption(el)).toBeNull();
  });

  test('code 2（機能がオフ）: disabled で理由が出る', async () => {
    stubAppleAiAvailability(2);
    const el = await renderSettings();
    await waitFor(() => findOption(el) !== null);
    const option = findOption(el);
    expect(option?.disabled).toBe(true);
    expect(el.textContent).toContain('オフになっています');
  });

  test('code 3（ダウンロード中）: disabled で理由が出る', async () => {
    stubAppleAiAvailability(3);
    const el = await renderSettings();
    await waitFor(() => findOption(el) !== null);
    const option = findOption(el);
    expect(option?.disabled).toBe(true);
    expect(el.textContent).toContain('ダウンロード中');
  });

  test('code 5（理由不明）: disabled で code2/3 とは別の理由が出る', async () => {
    stubAppleAiAvailability(5);
    const el = await renderSettings();
    await waitFor(() => findOption(el) !== null);
    const option = findOption(el);
    expect(option?.disabled).toBe(true);
    expect(el.textContent).toContain('確認できませんでした');
    expect(el.textContent).not.toContain('オフになっています');
    expect(el.textContent).not.toContain('ダウンロード中');
  });

  test('橋渡しに appleAiAvailability が無い: 1/4 と同じく選択肢が出ない', async () => {
    stubAppleAiAvailability(null);
    const el = await renderSettings();
    await new Promise((r) => setTimeout(r, 50));
    expect(findOption(el)).toBeNull();
  });
});
