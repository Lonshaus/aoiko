import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { setSetting } from '../lib/settings';
import { m } from '../paraglide/messages';

const { default: OpeningSetup } = await import('./OpeningSetup.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const tick = () => new Promise((r) => setTimeout(r, 30));
let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;
const text = () => container?.textContent ?? '';

function input(name: string): HTMLInputElement {
  return container!.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
}

function setValue(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function button(label: string): HTMLButtonElement | undefined {
  return [...container!.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  );
}

async function render(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(OpeningSetup, { target: container, props: {} });
  await waitFor(() => container!.querySelector('input[name="jigyoStartDate"]') !== null);
}

async function addExpense(): Promise<void> {
  setValue(input('openingKeihiTitle'), '名刺');
  setValue(input('openingKeihiAmount'), '10000');
  input('openingKeihiAmount')
    .closest('form')!
    .querySelector<HTMLButtonElement>('button[type="submit"]')!
    .click();
  await tick();
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

describe('開業設定：開業日・廃業日の入力と確認画面の案内', () => {
  test.each(['', '2026-12-31'])(
    '開業日が空欄のとき（廃業日 %j）は案内を出して確認画面へ進めない',
    async (close) => {
      await render();
      await addExpense();
      setValue(input('jigyoStartDate'), '');
      setValue(input('jigyoCloseDate'), close);
      await tick();
      expect(text()).toContain(m.opening_dates_invalid());
      const preview = button(m.opening_action_preview());
      expect(preview?.disabled).toBe(true);
      preview?.click();
      await tick();
      expect(button(m.opening_action_confirm())).toBeUndefined();
    },
  );

  test('開業日より前の保存済みの廃業日を別の廃業日で置き換えるときは、確認画面で置き換わることを示す', async () => {
    await setSetting('businessCloseDate', '2026-03-31');
    await render();
    setValue(input('jigyoStartDate'), '2026-07-01');
    setValue(input('jigyoCloseDate'), '2026-12-31');
    await addExpense();
    button(m.opening_action_preview())!.click();
    await waitFor(() => button(m.opening_action_confirm()) !== undefined);
    expect(text()).toContain(
      m.opening_close_date_replace_notice({ old: '2026-03-31', year: 2026 }),
    );
  });
});
