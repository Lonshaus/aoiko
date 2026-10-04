// dev server 限定の文書プレビュー選択欄。__DOC_PREVIEW__ が true な doc-preview project でのみ実行する。
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { DOC_PREVIEW_STORAGE_KEY } from '../lib/doc-preview';

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

function selectEl(): HTMLSelectElement {
  const heading = [...container!.querySelectorAll('h3')].find(
    (h) => h.textContent === '開発用：プレビュー対象',
  );
  const section = heading?.closest('section');
  const el = section?.querySelector('select');
  if (!el) {
    throw new Error('プレビュー選択欄が見付からない');
  }
  return el;
}
// onMount の読み込み完了前に db.delete() が走ると DatabaseClosedError が未処理で残るため待つ。
const MOUNT_SENTINEL = 'ZZZ9';

async function renderSettings(): Promise<void> {
  await db.settings.put({
    key: 'homeOfficeAccountRatios',
    value: { [MOUNT_SENTINEL]: '0.30' },
    updatedAt: Date.now(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Settings, { target: container, props: {} });
  await waitFor(() => container!.querySelector('select') !== null);
  await waitFor(() => container!.textContent!.includes(MOUNT_SENTINEL));
}

beforeEach(async () => {
  localStorage.clear();
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
  localStorage.clear();
  await db.delete();
});

describe('開発用：プレビュー対象', () => {
  test('区画が出て、選択肢が 4 個ある', async () => {
    await renderSettings();
    expect(container!.textContent).toContain('開発用：プレビュー対象');
    const options = selectEl().querySelectorAll('option');
    expect(options).toHaveLength(4);
  });

  test('初期値は localStorage の設定を反映する', async () => {
    localStorage.setItem(DOC_PREVIEW_STORAGE_KEY, 'windows');
    await renderSettings();
    expect(selectEl().value).toBe('windows');
  });

  test('選ぶと localStorage に保存され、reload が呼ばれる', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    await renderSettings();
    const select = selectEl();
    select.value = 'ios';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => localStorage.getItem(DOC_PREVIEW_STORAGE_KEY) === 'ios');
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
