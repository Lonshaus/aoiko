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
    await setSetting('ocrEngine', 'openai-compatible');
    const el = await renderSettings();
    await waitFor(() => findGeminiKeyInput(el) === null);
    expect(findGeminiKeyInput(el)).toBeNull();
  });
});
