// ML Kit の FeatureStatus（0 UNAVAILABLE / 1 DOWNLOADABLE / 2 DOWNLOADING / 3 AVAILABLE）
// ごとに選択肢の出し分けが正しいかを見る。0 とその他の未知値は選択肢ごと隠す、1/2 は
// 選び直せる余地があるので disabled のまま理由を出す。
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

function stubNanoAvailability(status: number | null): void {
  const nanoAvailability =
    status === null ? undefined : vi.fn().mockResolvedValue({ status, tokenLimit: null });
  vi.stubGlobal('window', Object.assign(window, { __aoikoNative: { nanoAvailability } }));
}

// onMount の直列読みが終わる前に afterEach の db.delete() が走ると DatabaseClosedError が
// 未処理の rejection として残り、テストは通るのに vitest が exit 1 になる。最後に読む
// homeOfficeAccountRatios に他へ出てこない科目コードを仕込み、画面に出るまで待って
// 読み込み完了を確かめる。
const MOUNT_SENTINEL = 'ZZZ9';

async function renderSettings(): Promise<HTMLElement> {
  await db.settings.put({
    key: 'homeOfficeAccountRatios',
    value: { [MOUNT_SENTINEL]: '0.30' },
    updatedAt: Date.now(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Settings, { target: container, props: {} });
  const el = container;
  await waitFor(() => el.querySelector('select') !== null);
  await waitFor(() => el.textContent.includes(MOUNT_SENTINEL));
  return el;
}

function findOption(el: HTMLElement): HTMLOptionElement | null {
  return el.querySelector('option[value="nano"]');
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

describe('端末内 Gemini Nano: 選択肢の出し分け', () => {
  test('status 0（UNAVAILABLE）: 選択肢が出ない', async () => {
    stubNanoAvailability(0);
    const el = await renderSettings();
    expect(findOption(el)).toBeNull();
  });

  test('status 1（DOWNLOADABLE）: disabled で理由が出る', async () => {
    stubNanoAvailability(1);
    const el = await renderSettings();
    await waitFor(() => findOption(el) !== null);
    const option = findOption(el);
    expect(option?.disabled).toBe(true);
    expect(el.textContent).toContain('準備できていません');
  });

  test('status 2（DOWNLOADING）: disabled で status 1 とは別の理由が出る', async () => {
    stubNanoAvailability(2);
    const el = await renderSettings();
    await waitFor(() => findOption(el) !== null);
    const option = findOption(el);
    expect(option?.disabled).toBe(true);
    expect(el.textContent).toContain('準備中です');
    expect(el.textContent).not.toContain('準備できていません');
  });

  test('status 3（AVAILABLE）: 選べる選択肢が出る', async () => {
    stubNanoAvailability(3);
    const el = await renderSettings();
    await waitFor(() => findOption(el) !== null);
    const option = findOption(el);
    expect(option).not.toBeNull();
    expect(option?.disabled).toBe(false);
  });

  test('未知の status（例：99）: 選択肢が出ない', async () => {
    stubNanoAvailability(99);
    const el = await renderSettings();
    expect(findOption(el)).toBeNull();
  });

  test('橋渡しに nanoAvailability が無い: status 0 と同じく選択肢が出ない', async () => {
    stubNanoAvailability(null);
    const el = await renderSettings();
    expect(findOption(el)).toBeNull();
  });
});
