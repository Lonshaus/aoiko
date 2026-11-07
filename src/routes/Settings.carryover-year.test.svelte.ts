// 年度は {@html} の訳文に埋め込まれる。復元などで文字列が入っていても HTML として解釈させない。
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
// onMount の読み込みが終わるまで待つための目印。最後に読む設定に入れる。
const MOUNT_SENTINEL = 'ZZZ9';

async function mountWithYear(value: unknown): Promise<HTMLElement> {
  await db.settings.bulkPut([
    { key: 'currentYear', value, updatedAt: Date.now() },
    { key: 'homeOfficeAccountRatios', value: { [MOUNT_SENTINEL]: '0.30' }, updatedAt: Date.now() },
  ]);
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Settings, { target: container, props: {} });
  await waitFor(() => (container!.textContent ?? '').includes(MOUNT_SENTINEL));
  return container;
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
  container?.remove();
  container = undefined;
  await db.delete();
});

describe('繰越の説明文に埋め込む年度', () => {
  test('保存値が HTML の文字列でも要素を作らず、既定の 2026 を示す', async () => {
    const c = await mountWithYear('<b id="inj">x</b>');
    expect(document.querySelector('#inj')).toBeNull();
    expect(c.textContent).toContain('2026-01-01');
  });

  test('整数の年度はそのまま示す', async () => {
    const c = await mountWithYear(2027);
    expect(c.textContent).toContain('2027-01-01');
  });
});
