// 確認を通るまで確定値を変えない作りのため、選択の見た目は別状態で持っている。
// 取り消しと閉じるで見た目が戻らないと、画面と保存される値が食い違う。
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

function radio(value: 'blue' | 'white'): HTMLInputElement {
  const el = container!.querySelector<HTMLInputElement>(
    `input[name="filingType"][value="${value}"]`,
  );
  if (!el) {
    throw new Error(`${value} のラジオが見付からない`);
  }
  return el;
}

function dialogButton(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) {
    throw new Error(`${label} のボタンが見付からない`);
  }
  return found;
}

async function renderSettings(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Settings, { target: container, props: {} });
  await waitFor(() => container!.querySelector('input[name="filingType"]') !== null);
  await new Promise((r) => setTimeout(r, 50));
}

async function chooseWhite(): Promise<void> {
  const white = radio('white');
  white.checked = true;
  white.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => document.body.textContent?.includes('確定申告方式を変更しますか？') === true);
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
  // 確認の対話は本文の scroll を止め、解除を 24ms 遅らせて予約する。環境が先に片付くと
  // document が無い所でその予約が起き、試験は全て通ったまま実行が失敗する。
  await new Promise((r) => setTimeout(r, 50));
  if (container !== undefined) {
    container.remove();
    container = undefined;
  }
  await db.delete();
});

describe('確定申告方式の切り替え確認', () => {
  test('取り消すと選択が青色申告へ戻る', async () => {
    await renderSettings();
    await chooseWhite();
    dialogButton('キャンセル').click();
    await waitFor(() => radio('blue').checked);
    expect(radio('white').checked).toBe(false);
    expect(container!.textContent).toContain('控除区分');
  });

  test('確定すると選択が白色申告になり、控除区分の欄が消える', async () => {
    await renderSettings();
    await chooseWhite();
    dialogButton('切り替える').click();
    await waitFor(() => radio('white').checked);
    expect(radio('blue').checked).toBe(false);
    await waitFor(() => container!.textContent?.includes('控除区分') === false);
  });

  test('取り消した直後に保存すると、青色申告が保存される', async () => {
    await renderSettings();
    await chooseWhite();
    dialogButton('キャンセル').click();
    await waitFor(() => radio('blue').checked);
    const form = radio('blue').closest('form');
    if (!form) {
      throw new Error('申報者資訊のフォームが見付からない');
    }
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => container!.textContent?.includes('保存しました') === true);
    expect(await getSetting('filingType')).toBe('blue');
  });

  test('Escape で閉じても選択が戻る', async () => {
    await renderSettings();
    await chooseWhite();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(() => radio('blue').checked);
    expect(radio('white').checked).toBe(false);
  });
});
