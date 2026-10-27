import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { setSetting } from '../lib/settings';
import { m } from '../paraglide/messages';

const { default: Settings } = await import('./Settings.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
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

function text(): string {
  return container?.textContent ?? '';
}

function buttonByText(label: string): HTMLButtonElement | undefined {
  return Array.from(container!.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label,
  );
}

function typeYear(value: string): void {
  const el = container!.querySelector<HTMLInputElement>('[name="currentTaxNen"]')!;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await setSetting('currentYear', 2026);
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
  container?.remove();
  container = undefined;
  await db.delete();
});

describe('処理年度の欄が範囲外のとき（G5）', () => {
  test('その年で動く 7 つのボタンを止めて案内し、繰越のプレビューも隠す。直すと戻る', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Settings, { target: container, props: {} });
    await waitFor(() => text().includes(MOUNT_SENTINEL));
    buttonByText(m.settings_carryover_preview_button())!.click();
    await waitFor(() => text().includes(m.settings_carryover_assets_label()));

    const labels = [
      m.settings_accountant_export_yayoi(),
      m.settings_accountant_export_generic(),
      m.settings_accountant_export_corrections(),
      m.settings_carryover_preview_button(),
      m.settings_carryover_apply_button(),
      m.settings_carryover_delete_button(),
      m.settings_bad_debt_reversal_button(),
    ];
    const invalid = m.common_integer_invalid({ min: 2020, max: 2099 });
    typeYear('1999');
    for (const label of labels) {
      expect(buttonByText(label)!.disabled, label).toBe(true);
    }
    expect(text()).not.toContain(m.settings_carryover_assets_label());
    // 年の欄の下に加え、繰越・貸倒引当金の繰戻し・会計士向け書き出しの各ボタンの横
    expect(text().split(invalid).length - 1).toBe(4);

    typeYear('2026');
    for (const label of labels) {
      expect(buttonByText(label)!.disabled, label).toBe(false);
    }
    expect(text()).not.toContain(invalid);
  });
});
