import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { m } from '../paraglide/messages';
import { getSetting } from '../lib/settings';

const { default: OpeningSetup } = await import('./OpeningSetup.svelte');

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 4000,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const tick = () => new Promise((r) => setTimeout(r, 20));

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function setValue(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function named(name: string): HTMLInputElement {
  return container!.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
}

function buttonByText(text: string): HTMLButtonElement {
  return Array.from(container!.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === text,
  )!;
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
  await db.delete();
});

describe('開業費の任意の償却額は円単位の整数だけを受け付ける', () => {
  test('小数の償却額で作成すると入力の誤りを表示し、仕訳を作らない', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(OpeningSetup, { target: container, props: {} });
    await waitFor(() => container!.querySelector('h2') !== null);

    setValue(container.querySelector<HTMLInputElement>('input[type="date"]')!, '2026-07-01');
    await tick();
    setValue(named('openingKeihiTitle'), '名刺');
    setValue(named('openingKeihiAmount'), '100000');
    named('openingKeihiAmount')
      .closest('form')!
      .querySelector<HTMLButtonElement>('button[type="submit"]')!
      .click();
    await tick();

    const custom = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ).find((r) => r.value === 'custom')!;
    custom.click();
    await waitFor(
      () => container!.querySelector('input[name="openingKeihiCustomAmortization"]') !== null,
    );
    setValue(named('openingKeihiCustomAmortization'), '100.5');
    await tick();

    buttonByText(m.opening_action_preview()).click();
    await tick();
    buttonByText(m.opening_action_confirm()).click();
    await waitFor(() => (container!.textContent ?? '').includes(m.common_amount_invalid()));
    await tick();

    expect(await db.journalEntries.count()).toBe(0);
    expect(await getSetting('businessStartDate')).toBeUndefined();
  });
});
