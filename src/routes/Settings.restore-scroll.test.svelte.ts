// 選択直後は確定ボタンが画面の下に隠れたままになる。読み込みに成功したときだけ見える位置へ寄せる。
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
let scrollCalls: { target: Element; connected: boolean; arg: unknown }[] = [];
let originalScrollIntoView: typeof Element.prototype.scrollIntoView | undefined;
// onMount の直列読み込みが終わる前に afterEach の db.delete() が走ると DatabaseClosedError が未処理で残るため、最後に読む設定に目印を仕込んで表示まで待つ。
const MOUNT_SENTINEL = 'ZZZ9';

function restoreInput(): HTMLInputElement {
  const el = container!.querySelector<HTMLInputElement>(
    'input[type="file"][accept*=".json"][accept*=".zip"]',
  );
  if (!el) {
    throw new Error('復元用のファイル入力が見付からない');
  }
  return el;
}

function applyButton(): HTMLButtonElement | undefined {
  return [...container!.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').includes('全データを置換して復元'),
  );
}

async function choose(content: string): Promise<void> {
  const input = restoreInput();
  const file = new File([content], 'backup.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  originalScrollIntoView = Element.prototype.scrollIntoView;
  scrollCalls = [];
  Element.prototype.scrollIntoView = function (
    this: Element,
    arg?: boolean | ScrollIntoViewOptions,
  ) {
    scrollCalls.push({ target: this, connected: this.isConnected, arg });
  };
  await db.settings.put({
    key: 'homeOfficeAccountRatios',
    value: { [MOUNT_SENTINEL]: '0.30' },
    updatedAt: Date.now(),
  });
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
  if (originalScrollIntoView) {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  } else {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  }
  await db.delete();
});

describe('バックアップ選択後の復元ボタン', () => {
  test('有効なバックアップを選ぶと、表示済みのボタンを画面の中央へ寄せる', async () => {
    await choose(
      JSON.stringify({
        version: 1,
        exportedAt: '2026-10-04T00:00:00.000Z',
        tables: { journalEntries: [] },
      }),
    );
    await waitFor(() => applyButton() !== undefined);
    await new Promise((r) => setTimeout(r, 100));
    const button = applyButton()!;
    expect(scrollCalls).toHaveLength(1);
    expect(scrollCalls[0]!.target).toBe(button);
    expect(scrollCalls[0]!.connected).toBe(true);
    expect(scrollCalls[0]!.arg).toEqual({ block: 'center' });
  });

  test('読み込みに失敗したときは寄せない', async () => {
    await choose('これは JSON ではない');
    await waitFor(() => container!.querySelector('.text-destructive') !== null);
    await new Promise((r) => setTimeout(r, 100));
    expect(applyButton()).toBeUndefined();
    expect(scrollCalls).toHaveLength(0);
  });
});
