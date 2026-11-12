import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { getSetting } from '../lib/settings';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { m } from '../paraglide/messages';

const { default: Settings } = await import('./Settings.svelte');

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const MOUNT_SENTINEL = 'ZZZ9';

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.accounts.bulkAdd(ACCOUNTS_2026);
  await db.settings.put({
    key: 'homeOfficeAccountRatios',
    value: { [MOUNT_SENTINEL]: '0.30' },
    updatedAt: Date.now(),
  });
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

describe('処理年度の保存', () => {
  test('処理年度を 2027 に保存すると 2027 年度の科目が作られる', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Settings, { target: container, props: {} });
    await waitFor(() => (container!.textContent ?? '').includes(MOUNT_SENTINEL));
    const year = container.querySelector<HTMLInputElement>('input[name="currentTaxNen"]')!;
    year.value = '2027';
    year.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    year.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    flushSync();
    await waitFor(() => (container!.textContent ?? '').includes(m.settings_basic_saved()));
    expect(await getSetting('currentYear')).toBe(2027);
    expect(await db.accounts.where({ year: 2027 }).count()).toBe(ACCOUNTS_2026.length);
  });
});
