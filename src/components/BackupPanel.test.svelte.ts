import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { getSetting } from '../lib/settings';

const { default: BackupPanel } = await import('./BackupPanel.svelte');

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

function input(name: string): HTMLInputElement | null {
  return document.body.querySelector<HTMLInputElement>(`input[name="${name}"]`);
}

function dialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="alertdialog"]');
}

function buttonIn(root: ParentNode, label: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label);
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.settings.put({
    key: 'backupParts',
    value: ['books', 'business', 'filer'],
    updatedAt: 1,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(BackupPanel, { target: container, props: {} });
  await waitFor(() => input('backup-parts-filer')?.checked === true);
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

describe('BackupPanel の区分の選択', () => {
  test('旧の 2 つの切替は画面に無い', () => {
    const text = container!.textContent ?? '';
    expect(text).not.toContain('バックアップに API キーを含める');
    expect(text).not.toContain('申告者情報（利用者識別番号・氏名・住所・税務署）を含める');
    expect(text).toContain('バックアップに含める項目');
  });

  test('API キーを選ぶと backupParts に入る', async () => {
    input('backup-parts-apiKeys')!.click();
    await waitFor(() => input('backup-parts-apiKeys')!.checked);
    let saved: unknown;
    for (let i = 0; i < 100 && !Array.isArray(saved); i++) {
      const value = await getSetting('backupParts');
      saved = value?.includes('apiKeys') ? value : undefined;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(saved).toEqual(['books', 'business', 'apiKeys', 'filer']);
  });

  test('帳簿データは外せない', () => {
    const books = input('backup-parts-books')!;
    expect(books.checked).toBe(true);
    expect(books.disabled).toBe(true);
  });

  test('書き出しの対話は backupParts から始まり、すべて外すと「書き出す」を押せない', async () => {
    buttonIn(container!, 'バックアップを書き出す')!.click();
    await waitFor(() => dialog() !== null && input('export-parts-books') !== null);
    const checked = [...dialog()!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .filter((i) => i.checked)
      .map((i) => i.name);
    expect(checked).toEqual(['export-parts-books', 'export-parts-business', 'export-parts-filer']);
    const proceed = buttonIn(dialog()!, '書き出す')!;
    expect(proceed.disabled).toBe(false);
    for (const id of ['books', 'business', 'filer']) {
      input(`export-parts-${id}`)!.click();
      flushSync();
    }
    await waitFor(() => proceed.disabled);
    expect(input('export-parts-attachments')!.disabled).toBe(true);
    expect(await getSetting('backupParts')).toEqual(['books', 'business', 'filer']);
  });
});
