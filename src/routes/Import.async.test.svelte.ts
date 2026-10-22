import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { db } from '../db/db';
import type { Account } from '../db/types';
import type { CsvParser } from '../parsers/types';
import { setLocale } from '../paraglide/runtime';
import { m } from '../paraglide/messages';

const { parserA, gate } = vi.hoisted(() => {
  const parserA: CsvParser = {
    name: 'parser-a',
    displayName: 'パーサーA',
    accountCode: '1130',
    encoding: 'utf-8',
    parse: () => [
      { date: '2026-01-10', description: 'alpha', amount: '1000', side: 'credit', rawRow: {} },
      { date: '2026-01-11', description: 'beta', amount: '2000', side: 'credit', rawRow: {} },
    ],
  };
  return {
    parserA,
    gate: { resolve: null as null | (() => void), calls: 0, signals: [] as AbortSignal[] },
  };
});

vi.mock('../parsers', () => ({
  PARSERS: [parserA],
  findParser: (name: string) => (name === parserA.name ? parserA : null),
}));

vi.mock('../lib/llm-adapter', () => ({
  createLlmAdapter: async () => ({
    external: false,
    destinationHost: '',
    generateJson: (_prompt: string, _image?: unknown, options?: { signal?: AbortSignal }) => {
      gate.calls += 1;
      if (options?.signal) {
        gate.signals.push(options.signal);
      }
      return new Promise((resolve) => {
        gate.resolve = () =>
          resolve({
            classifications: [
              { ref: '0', accountCode: '5200', confidence: 'high', reason: '' },
              { ref: '1', accountCode: '5200', confidence: 'high', reason: '' },
            ],
          });
      });
    },
  }),
}));

const { default: Import } = await import('./Import.svelte');
const { importDraft } = await import('../stores/import-draft.svelte');
const { analysis } = await import('../stores/analysis.svelte');
const { ledger } = await import('../stores/ledger.svelte');

const ACCOUNTS: Account[] = [
  { code: '5200', year: 2026, name: '消耗品費', category: 'expense', displayOrder: 1 },
];

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  setLocale('ja', { reload: false });
  await db.delete();
  await db.open();
  // ledger の科目は liveQuery の購読から届くが、db.delete() と重なった問い合わせの扱いで
  // 届く時期も届くかどうかも揺れるため、テストでは値を固定する。
  vi.spyOn(ledger, 'accounts', 'get').mockReturnValue(ACCOUNTS);
  gate.resolve = null;
  gate.calls = 0;
  gate.signals.length = 0;
});

afterEach(async () => {
  unmountImport();
  importDraft.reset();
  importDraft.success = '';
  importDraft.llmStatus = '';
  if (analysis.job !== null) {
    analysis.finish(analysis.job, 'cancelled');
  }
  analysis.unseen = {};
  analysis.notices = [];
  ledger.accounts = [];
  await db.delete();
});

function mountImport(): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Import, { target: container, props: {} });
  flushSync();
  return container;
}

function unmountImport(): void {
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  container?.remove();
  container = undefined;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

function findButton(c: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(c.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(label),
  );
}

async function loadCsv(c: HTMLElement): Promise<void> {
  const input = c.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', {
    value: [new File(['dummy'], 'a.csv', { type: 'text/csv' })],
    configurable: true,
  });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => importDraft.rows.length > 0);
  flushSync();
}

async function startClassify(c: HTMLElement): Promise<void> {
  await loadCsv(c);
  findButton(c, m.import_llm_button())!.click();
  await waitFor(() => gate.calls === 1);
  flushSync();
}

describe('Import: 分類中に画面を離れる', () => {
  test('離れて戻っても、読み込んだ行と分類結果が残っている', async () => {
    const first = mountImport();
    await startClassify(first);
    unmountImport();

    gate.resolve!();
    await waitFor(() => importDraft.llmStatus !== '');
    expect(analysis.unseen.classify).toBe('done');

    const second = mountImport();
    expect(second.textContent).toContain('選択中：a.csv');
    expect(second.textContent).toContain(importDraft.llmStatus);
    expect(second.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(importDraft.rows.map((r) => r.counterpartAccountCode)).toEqual(['5200', '5200']);
    expect(analysis.unseen.classify).toBeUndefined();
  });

  test('分類の途中で戻ると、実行中の表示と取消しボタンが出る', async () => {
    const first = mountImport();
    await startClassify(first);
    unmountImport();
    const second = mountImport();
    expect(findButton(second, m.import_llm_button_running())).toBeDefined();
    expect(findButton(second, m.analysis_cancel())).toBeDefined();
    gate.resolve!();
    await waitFor(() => !analysis.busy);
  });
});

describe('Import: 分類中の入力保護', () => {
  test('ファイル選択と取込元の選択が無効になり、change が来ても読み込まない', async () => {
    const c = mountImport();
    await startClassify(c);
    expect((c.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(true);
    expect((c.querySelector('select[name="importParser"]') as HTMLSelectElement).disabled).toBe(
      true,
    );
    const hash = importDraft.fileHash;
    const input = c.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File(['x'], 'b.csv', { type: 'text/csv' })],
      configurable: true,
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(importDraft.fileName).toBe('a.csv');
    expect(importDraft.fileHash).toBe(hash);
    gate.resolve!();
    await waitFor(() => !analysis.busy);
    flushSync();
    expect((c.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(false);
  });
});

describe('Import: 他の画面で解析中', () => {
  test('AI 分類ボタンが無効になり、理由が出る', async () => {
    const c = mountImport();
    await loadCsv(c);
    const other = analysis.begin('receipt')!;
    flushSync();
    expect(findButton(c, m.import_llm_button())!.disabled).toBe(true);
    expect(c.textContent).toContain(m.analysis_busy_other());
    analysis.finish(other, 'cancelled');
    flushSync();
    expect(findButton(c, m.import_llm_button())!.disabled).toBe(false);
  });
});

describe('Import: 取消し', () => {
  test('中止できない経路は「中止しています…」のまま待ち、終わると提案を捨てて再開できる', async () => {
    const c = mountImport();
    await startClassify(c);
    findButton(c, m.analysis_cancel())!.click();
    flushSync();
    expect(gate.signals[0]?.aborted).toBe(true);
    expect(findButton(c, m.analysis_cancelling())!.disabled).toBe(true);
    expect(c.textContent).toContain(m.analysis_cancelling_hint());

    gate.resolve!();
    await waitFor(() => !analysis.busy);
    flushSync();
    expect(importDraft.rows.every((r) => r.counterpartAccountCode === '')).toBe(true);
    expect(findButton(c, m.import_llm_button())!.disabled).toBe(false);
    expect(c.querySelector('[class*="border-destructive"]')).toBeNull();
  });
});
