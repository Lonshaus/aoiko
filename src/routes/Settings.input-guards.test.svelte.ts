import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { getSetting, setSetting } from '../lib/settings';
import { m } from '../paraglide/messages';

const { default: Settings } = await import('./Settings.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const MOUNT_SENTINEL = 'ZZZ9';

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function field(name: string): HTMLInputElement {
  return container!.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
}

function type(name: string, value: string): void {
  const el = field(name);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.settings.put({
    key: 'homeOfficeAccountRatios',
    value: { [MOUNT_SENTINEL]: '0.30' },
    updatedAt: Date.now(),
  });
  await setSetting('currentYear', 2026);
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Settings, { target: container, props: {} });
  await waitFor(() => (container!.textContent ?? '').includes(MOUNT_SENTINEL));
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

describe('設定の処理年度', () => {
  test.each(['', '1999', '2100', '2.5'])('%j は誤りを示し、保存しない', async (bad) => {
    type('currentTaxNen', bad);
    expect(container!.textContent).toContain(m.common_integer_invalid({ min: 2020, max: 2099 }));
    field('currentTaxNen')
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    flushSync();
    await new Promise((r) => setTimeout(r, 50));
    expect(await getSetting('currentYear')).toBe(2026);
    expect(container!.textContent).not.toContain(m.settings_basic_saved());
  });

  test('範囲内の年度は保存される', async () => {
    type('currentTaxNen', '2027');
    field('currentTaxNen')
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    flushSync();
    await waitFor(() => (container!.textContent ?? '').includes(m.settings_basic_saved()));
    expect(await getSetting('currentYear')).toBe(2027);
  });
});
