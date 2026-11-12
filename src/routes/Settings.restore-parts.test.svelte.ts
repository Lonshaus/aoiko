// 復元する区分は、選んだ時点の検証結果から出す。選ばなかった区分はこの端末のデータを残す。
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { BOOK_TABLES } from '../backup/parts';
import type { JournalEntry } from '../db/types';
import { m } from '../paraglide/messages';

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
let originalScrollIntoView: typeof Element.prototype.scrollIntoView | undefined;
// onMount の読み込みが終わるまで待つための目印（Settings.restore-scroll と同じ）。
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
    (b.textContent ?? '').includes('選んだ項目を置換して復元'),
  );
}

function partInputs(): HTMLInputElement[] {
  return [...container!.querySelectorAll<HTMLInputElement>('input[name^="restore-parts-"]')];
}

function partInput(id: string): HTMLInputElement {
  const el = container!.querySelector<HTMLInputElement>(`input[name="restore-parts-${id}"]`);
  if (!el) {
    throw new Error(`区分の input が無い: ${id}`);
  }
  return el;
}

async function choose(content: string): Promise<void> {
  const input = restoreInput();
  const file = new File([content], 'backup.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function bookTables(overrides: Record<string, unknown[]> = {}): Record<string, unknown[]> {
  return { ...Object.fromEntries(BOOK_TABLES.map((name) => [name, []])), ...overrides };
}

const entry: JournalEntry = {
  id: 'local-entry',
  date: '2026-05-01',
  year: 2026,
  description: '端末の仕訳',
  status: 'confirmed',
  source: 'manual',
  createdAt: 1,
  confirmedAt: 1,
};

beforeEach(async () => {
  await db.delete();
  await db.open();
  originalScrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = () => {};
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
  vi.restoreAllMocks();
  await db.delete();
});

describe('復元する区分の選択', () => {
  test('6 区分を含むバックアップは 6 つ出し、AI と API キーだけ外しておく', async () => {
    await choose(
      JSON.stringify({
        version: 1,
        exportedAt: '2026-11-01T00:00:00.000Z',
        parts: ['books', 'attachments', 'business', 'ai', 'apiKeys', 'filer'],
        tables: bookTables({ attachments: [], settings: [] }),
      }),
    );
    await waitFor(() => applyButton() !== undefined);
    expect(partInputs().map((i) => [i.name.replace('restore-parts-', ''), i.checked])).toEqual([
      ['books', true],
      ['attachments', true],
      ['business', true],
      ['ai', false],
      ['apiKeys', false],
      ['filer', true],
    ]);
  });

  test('業務の設定だけの v2 は 1 つだけ出す', async () => {
    await choose(
      JSON.stringify({
        version: 2,
        exportedAt: '2026-11-01T00:00:00.000Z',
        parts: ['business'],
        tables: { settings: [] },
      }),
    );
    await waitFor(() => applyButton() !== undefined);
    expect(partInputs().map((i) => i.name)).toEqual(['restore-parts-business']);
  });

  test.each([
    [
      'parts が不正',
      { version: 2, exportedAt: 'x', parts: ['business', 'x'], tables: {} },
      m.error_backup_parts_invalid(),
    ],
    ['version 3', { version: 3, exportedAt: 'x', tables: {} }, 'バックアップ形式バージョン 3'],
  ])('%s のファイルは選んだ時点でエラーを出し、復元ボタンを出さない', async (_l, body, text) => {
    await choose(JSON.stringify(body));
    await waitFor(() => (container!.textContent ?? '').includes(text));
    await new Promise((r) => setTimeout(r, 50));
    expect(applyButton()).toBeUndefined();
  });

  test('__proto__ の欄を持つ行のファイルも選んだ時点で弾く', async () => {
    await choose(
      '{"version":1,"exportedAt":"x","tables":{"vendors":[{"id":"v1","name":"業者","__proto__":{}}]}}',
    );
    await waitFor(() => (container!.textContent ?? '').includes('__proto__'));
    await new Promise((r) => setTimeout(r, 50));
    expect(applyButton()).toBeUndefined();
  });

  test('すべて外すと復元ボタンを押せない', async () => {
    await choose(
      JSON.stringify({
        version: 2,
        exportedAt: '2026-11-01T00:00:00.000Z',
        parts: ['business', 'filer'],
        tables: { settings: [] },
      }),
    );
    await waitFor(() => applyButton() !== undefined);
    expect(applyButton()!.disabled).toBe(false);
    partInput('business').click();
    partInput('filer').click();
    await waitFor(() => applyButton()!.disabled);
  });

  test('業務の設定だけを選んで復元すると、この端末の仕訳は残る', async () => {
    await db.journalEntries.add(entry);
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      reload,
    } as Location);
    await choose(
      JSON.stringify({
        version: 1,
        exportedAt: '2026-11-01T00:00:00.000Z',
        tables: {
          journalEntries: [],
          settings: [{ key: 'userBusinessName', value: 'バックアップの屋号', updatedAt: 1 }],
        },
      }),
    );
    await waitFor(() => applyButton() !== undefined);
    partInput('books').click();
    await waitFor(() => !partInput('books').checked);
    applyButton()!.click();
    await waitFor(() => document.body.querySelector('[role="alertdialog"]') !== null);
    const action = [
      ...document.body.querySelector('[role="alertdialog"]')!.querySelectorAll('button'),
    ].find((b) => (b.textContent ?? '').trim() === '置換して復元')!;
    action.click();
    await waitFor(() => reload.mock.calls.length > 0);
    expect((await db.journalEntries.toArray()).map((e) => e.id)).toEqual(['local-entry']);
    expect((await db.settings.get('userBusinessName'))?.value).toBe('バックアップの屋号');
  });
});
