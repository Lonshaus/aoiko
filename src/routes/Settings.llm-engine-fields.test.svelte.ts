// エンジンごとに出す入力欄を切り替えているので、Gemini 選択時だけ鍵欄が出るかを見る。
// select の change イベント経由の再現は happy-dom が `:checked` 疑似セレクタを
// 実装していないため使えない（bind:value の内部実装が依存する）。DB に保存済みの
// エンジンを読み込ませる経路で確かめる。

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { setSetting } from '../lib/settings';

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

async function renderSettings(): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Settings, { target: container, props: {} });
  const el = container;
  await waitFor(() => el.querySelector('option[value="gemini"]') !== null);
  // onMount の getSetting チェーンが setSetting だけでは終わらず、
  // afterEach の db.delete() と競合して DatabaseClosedError を投げるため待つ。
  await new Promise((r) => setTimeout(r, 50));
  return el;
}

function findGeminiKeyInput(el: HTMLElement): HTMLInputElement | null {
  return el.querySelector('input[placeholder="AIza..."]');
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

describe('LLM 連動: エンジンごとの入力欄の出し分け', () => {
  test('gemini 選択時: Gemini API キー欄が出る', async () => {
    const el = await renderSettings();
    expect(findGeminiKeyInput(el)).not.toBeNull();
  });

  test('openai-compatible 選択時: Gemini API キー欄は出ない', async () => {
    await setSetting('aiEngine', 'openai-compatible');
    const el = await renderSettings();
    await waitFor(() => findGeminiKeyInput(el) === null);
    expect(findGeminiKeyInput(el)).toBeNull();
  });
});

describe('LLM 連動: 選択肢の無い値が保存に残っている場合', () => {
  test('disabled の選択肢として生値を出す', async () => {
    await setSetting('aiEngine', 'tesseract' as never);
    const el = await renderSettings();
    await waitFor(() => el.querySelector('option[value="tesseract"]') !== null);
    const option = el.querySelector<HTMLOptionElement>('option[value="tesseract"]');
    expect(option).not.toBeNull();
    expect(option?.disabled).toBe(true);
  });

  test('選び直さずに保存しても disabled の選択肢は残り、select は空欄にならない', async () => {
    await setSetting('aiEngine', 'tesseract' as never);
    const el = await renderSettings();
    await waitFor(() => el.querySelector('option[value="tesseract"]') !== null);
    const section = Array.from(el.querySelectorAll('section')).find((s) =>
      (s.textContent ?? '').includes('AI 機能'),
    );
    if (section === undefined) {
      throw new Error('AI 機能セクションが見つからない');
    }
    const saveButton = Array.from(section.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('保存'),
    );
    if (saveButton === undefined) {
      throw new Error('保存ボタンが見つからない');
    }
    saveButton.click();
    await waitFor(() => (el.textContent ?? '').includes('保存しました'));
    const select = section.querySelector('select') as HTMLSelectElement;
    expect(section.querySelector('option[value="tesseract"]')).not.toBeNull();
    expect(select.value).toBe('tesseract');
  });
});
