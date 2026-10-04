// __DOC_PREVIEW__ が false（native project）の下では、開発用の文書プレビュー区画が出ない。
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
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
// onMount の読み込み完了前に db.delete() が走ると DatabaseClosedError が未処理で残るため待つ。
const MOUNT_SENTINEL = 'ZZZ9';

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
  await db.delete();
});

describe('ビルド成果物では開発用の文書プレビュー区画が出ない', () => {
  test('見出しが見付からない', async () => {
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
    expect(container.textContent).not.toContain('開発用：プレビュー対象');
  });
});
