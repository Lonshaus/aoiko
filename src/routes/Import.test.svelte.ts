import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { db } from '../db/db';
import type { CsvParser } from '../parsers/types';

const { parserA, parserB } = vi.hoisted(() => {
  const parserA: CsvParser = {
    name: 'parser-a',
    displayName: 'パーサーA',
    accountCode: '1130',
    encoding: 'utf-8',
    parse: () => [
      { date: '2026-01-10', description: 'A由来', amount: '1000', side: 'debit', rawRow: {} },
    ],
  };
  const parserB: CsvParser = {
    name: 'parser-b',
    displayName: 'パーサーB',
    accountCode: '2120',
    encoding: 'utf-8',
    parse: () => [
      { date: '2026-02-20', description: 'B由来', amount: '2000', side: 'credit', rawRow: {} },
    ],
  };
  return { parserA, parserB };
});

vi.mock('../parsers', () => ({
  PARSERS: [parserA, parserB],
  findParser: (name: string) => [parserA, parserB].find((p) => p.name === name) ?? null,
}));

const { default: Import } = await import('./Import.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}
// description は <input value> なので textContent には出ない。行データの識別には日付列を使う。
function rowDates(c: HTMLElement): string[] {
  return Array.from(c.querySelectorAll('tbody tr td:first-child')).map(
    (td) => td.textContent?.trim() ?? '',
  );
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  await db.delete();
  await db.open();
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Import, { target: container, props: {} });
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

async function loadFile(c: HTMLElement): Promise<void> {
  const fileInput = c.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['dummy'], 'a.csv', { type: 'text/csv' });
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => rowDates(c).length > 0);
}

function changeParser(c: HTMLElement, name: string): void {
  const parserSelect = c.querySelector('select') as HTMLSelectElement;
  parserSelect.value = name;
  parserSelect.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

describe('Import: 取込元を選び直した時の再解析行の破棄', () => {
  test('ファイル読込後に取込元を切り替えると、以前の parser の行は破棄される', async () => {
    const c = container as HTMLElement;
    await loadFile(c);
    expect(rowDates(c)).toEqual(['2026-01-10']);

    changeParser(c, parserB.name);

    expect(rowDates(c)).toEqual([]);
    expect(c.textContent).toContain('取込元を変更したため');
  });

  test('取込元を切り替えていない限り、行は保持される', async () => {
    const c = container as HTMLElement;
    await loadFile(c);

    changeParser(c, parserA.name);

    expect(rowDates(c)).toEqual(['2026-01-10']);
    expect(c.textContent).not.toContain('取込元を変更したため');
  });

  test('解析成功後は input.value がクリアされ、同じファイルを選び直せる', async () => {
    const c = container as HTMLElement;
    const fileInput = c.querySelector('input[type="file"]') as HTMLInputElement;
    await loadFile(c);
    expect(fileInput.value).toBe('');
  });
});
