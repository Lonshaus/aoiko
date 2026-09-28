// 青色申告特別控除の eTax 選択肢と、現金主義（cashBasisElection）の
// チェックボックスが保存・再読込後も保持されるかを見る。

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { getSetting } from '../lib/settings';

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
// onMount の直列読み込みが終わる前に afterEach の db.delete() が走ると DatabaseClosedError が未処理で残るため、最後に読む設定に目印を仕込んで表示まで待つ。
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
  await waitFor(() => el.querySelector('option[value="eTax"]') !== null);
  await waitFor(() => (el.textContent ?? '').includes(MOUNT_SENTINEL));
  return el;
}

function findCashBasisCheckbox(el: HTMLElement): HTMLInputElement | null {
  const label = Array.from(el.querySelectorAll('label')).find((l) =>
    (l.textContent ?? '').includes('現金主義'),
  );
  return label?.querySelector('input[type="checkbox"]') ?? null;
}

function findBasicInfoSaveButton(el: HTMLElement): HTMLButtonElement | null {
  const select = el.querySelector('option[value="eTax"]')?.closest('select');
  const form = select?.closest('form');
  return form?.querySelector('button[type="submit"]') ?? null;
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

describe('青色申告特別控除の区分に eTax 選択肢がある', () => {
  test('option[value="eTax"] が存在する', async () => {
    const el = await renderSettings();
    expect(el.querySelector('option[value="eTax"]')).not.toBeNull();
  });
});

describe('現金主義（cashBasisElection）の保存・再読込', () => {
  test('チェックして保存すると設定が true になり、再読込後も表示に反映される', async () => {
    const el = await renderSettings();
    const checkbox = findCashBasisCheckbox(el);
    if (checkbox === null) {
      throw new Error('現金主義のチェックボックスが見つからない');
    }
    expect(checkbox.checked).toBe(false);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    const saveButton = findBasicInfoSaveButton(el);
    if (saveButton === null) {
      throw new Error('基本情報の保存ボタンが見つからない');
    }
    saveButton.click();
    await waitFor(() => (el.textContent ?? '').includes('保存しました'));
    expect(await getSetting('cashBasisElection')).toBe(true);

    unmount(instance!);
    instance = undefined;
    container?.remove();
    container = undefined;
    const reloaded = await renderSettings();
    const reloadedCheckbox = findCashBasisCheckbox(reloaded);
    await waitFor(() => reloadedCheckbox?.checked === true);
    expect(reloadedCheckbox?.checked).toBe(true);
  });
});
