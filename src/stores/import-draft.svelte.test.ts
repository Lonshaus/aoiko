import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { db } from '../db/db';
import type { Account } from '../db/types';
import type { LlmCallOptions } from '../domain/llm';
import type { CsvParser } from '../parsers/types';
import { hasUnloadRisk } from '../router.svelte';

const { parserA, parserB, adapterRef } = vi.hoisted(() => {
  const parserA: CsvParser = {
    name: 'parser-a',
    displayName: 'パーサーA',
    accountCode: '1130',
    encoding: 'utf-8',
    parse: (text: string) =>
      text.split('\n').map((line, i) => ({
        date: `2026-01-${String(i + 1).padStart(2, '0')}`,
        description: line,
        amount: '1000',
        side: 'credit' as const,
        rawRow: {},
      })),
  };
  const parserB: CsvParser = { ...parserA, name: 'parser-b', displayName: 'パーサーB' };
  return {
    parserA,
    parserB,
    adapterRef: {
      generateJson: null as unknown as (
        prompt: string,
        image?: unknown,
        options?: LlmCallOptions,
      ) => Promise<unknown>,
    },
  };
});

vi.mock('../parsers', () => ({
  PARSERS: [parserA, parserB],
  findParser: (name: string) => [parserA, parserB].find((p) => p.name === name) ?? null,
}));

vi.mock('../lib/llm-adapter', () => {
  const adapter = () => ({
    external: false,
    destinationHost: '',
    generateJson: (prompt: string, image?: unknown, options?: LlmCallOptions) =>
      adapterRef.generateJson(prompt, image, options),
  });
  return {
    createLlmAdapter: async () => adapter(),
    createLlmAdapterWithConfig: async () => ({
      adapter: adapter(),
      config: {
        engine: 'openai-compatible',
        model: 'm',
        apiKey: '',
        baseUrl: 'http://localhost:1',
      },
    }),
  };
});

const { importDraft } = await import('./import-draft.svelte');
const { analysis } = await import('./analysis.svelte');
const { ledger } = await import('./ledger.svelte');

const ACCOUNTS: Account[] = [
  { code: '5200', year: 2026, name: '消耗品費', category: 'expense', displayOrder: 1 },
];

function csv(lines: string[], name = 'a.csv'): File {
  return new File([lines.join('\n')], name, { type: 'text/csv' });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const SUGGEST_ALL = {
  classifications: [
    { ref: '0', accountCode: '5200', confidence: 'high', reason: '' },
    { ref: '1', accountCode: '5200', confidence: 'low', reason: '' },
  ],
};

beforeEach(async () => {
  await db.delete();
  await db.open();
  // ledger の科目は liveQuery の購読から届くが、db.delete() と重なった問い合わせの扱いで
  // 届く時期も届くかどうかも揺れるため、テストでは値を固定する。
  vi.spyOn(ledger, 'accounts', 'get').mockReturnValue(ACCOUNTS);
  adapterRef.generateJson = async () => SUGGEST_ALL;
});

afterEach(async () => {
  importDraft.reset();
  importDraft.selectedParserName = 'parser-a';
  importDraft.success = '';
  importDraft.llmStatus = '';
  importDraft.importing = false;
  if (analysis.job !== null) {
    analysis.finish(analysis.job, 'cancelled');
  }
  analysis.viewing = null;
  analysis.unseen = {};
  analysis.notices = [];
  ledger.accounts = [];
  await db.delete();
});

async function load(lines = ['alpha', 'beta']) {
  const result = await importDraft.loadFile(csv(lines));
  expect(importDraft.rows.length).toBe(lines.length);
  return result;
}

async function prepare() {
  const prepared = await importDraft.prepareClassify();
  expect(prepared).not.toBeNull();
  return prepared!;
}

describe('状態の保持', () => {
  test('読み込んだ行・ファイル名・ハッシュが store に残る', async () => {
    expect(await load()).toBe('clear-input');
    expect(importDraft.fileName).toBe('a.csv');
    expect(importDraft.fileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(importDraft.rows.map((r) => r.description)).toEqual(['alpha', 'beta']);
    expect(importDraft.dirty).toBe(true);
    expect(hasUnloadRisk()).toBe(true);
  });

  test('reset で行とファイル情報を消す', async () => {
    await load();
    importDraft.reset();
    expect(importDraft.rows).toEqual([]);
    expect(importDraft.fileName).toBe('');
    expect(importDraft.fileHash).toBe('');
    expect(importDraft.dirty).toBe(false);
  });

  test('取込中は未保存として数えない', async () => {
    await load();
    importDraft.importing = true;
    expect(importDraft.dirty).toBe(false);
  });
});

describe('分類', () => {
  test('提案が行に入り、状況文言と通知が付く', async () => {
    await load();
    await importDraft.runClassify(await prepare());
    expect(importDraft.rows.map((r) => r.counterpartAccountCode)).toEqual(['5200', '5200']);
    expect(importDraft.rows.map((r) => r.llmConfidence)).toEqual(['high', 'low']);
    expect(importDraft.llmStatus).not.toBe('');
    expect(analysis.busy).toBe(false);
    expect(analysis.unseen.classify).toBe('done');
  });

  test('解析中は 2 件目の準備を断る', async () => {
    await load();
    const gate = deferred<unknown>();
    adapterRef.generateJson = () => gate.promise;
    const running = importDraft.runClassify(await prepare());
    expect(await importDraft.prepareClassify()).toBeNull();
    gate.resolve(SUGGEST_ALL);
    await running;
  });

  test('失敗はエラーとして持つ', async () => {
    await load();
    adapterRef.generateJson = async () => {
      throw new Error('boom');
    };
    await importDraft.runClassify(await prepare());
    expect(importDraft.error).toBe('boom');
    expect(analysis.unseen.classify).toBe('failed');
  });
});

describe('取消し', () => {
  test('中止できる経路は reject の時点で手放し、エラーも提案も残さない', async () => {
    await load();
    adapterRef.generateJson = (_p, _i, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    const running = importDraft.runClassify(await prepare());
    await vi.waitFor(() => expect(analysis.isRunning('classify')).toBe(true));
    analysis.cancel();
    await running;
    expect(analysis.busy).toBe(false);
    expect(importDraft.error).toBe('');
    expect(importDraft.rows.every((r) => r.counterpartAccountCode === '')).toBe(true);
  });

  test('中止できない経路は終わるまで「取消中」で、戻った提案は捨てる', async () => {
    await load();
    const gate = deferred<unknown>();
    adapterRef.generateJson = () => gate.promise;
    const running = importDraft.runClassify(await prepare());
    analysis.cancel();
    expect(analysis.isCancelling('classify')).toBe(true);
    expect(analysis.begin('receipt')).toBeNull();
    gate.resolve(SUGGEST_ALL);
    await running;
    expect(analysis.busy).toBe(false);
    expect(importDraft.rows.every((r) => r.counterpartAccountCode === '')).toBe(true);
    expect(analysis.unseen.classify).toBeUndefined();
  });
});

describe('入力の保護', () => {
  test('分類中は新しい CSV の読み込みを store が拒否する', async () => {
    await load();
    const gate = deferred<unknown>();
    adapterRef.generateJson = () => gate.promise;
    const running = importDraft.runClassify(await prepare());
    const hashBefore = importDraft.fileHash;
    expect(await importDraft.loadFile(csv(['other'], 'b.csv'))).toBe('rejected');
    expect(importDraft.fileHash).toBe(hashBefore);
    expect(importDraft.rows.map((r) => r.description)).toEqual(['alpha', 'beta']);
    analysis.cancel();
    expect(await importDraft.loadFile(csv(['other'], 'b.csv'))).toBe('rejected');
    gate.resolve(SUGGEST_ALL);
    await running;
    expect(await importDraft.loadFile(csv(['other'], 'b.csv'))).toBe('clear-input');
  });

  test('ロックを迂回して fileHash が変わっても、古い分類の提案は書き込まれない', async () => {
    await load();
    const gate = deferred<unknown>();
    adapterRef.generateJson = () => gate.promise;
    const running = importDraft.runClassify(await prepare());
    importDraft.fileHash = 'another-file-hash';
    gate.resolve(SUGGEST_ALL);
    await running;
    expect(importDraft.rows.every((r) => r.counterpartAccountCode === '')).toBe(true);
    expect(importDraft.llmStatus).toBe('');
    expect(analysis.busy).toBe(false);
  });

  test('準備のあとでファイルが変わっていたら実行を始めない', async () => {
    await load();
    const prepared = await prepare();
    importDraft.fileHash = 'another-file-hash';
    await importDraft.runClassify(prepared);
    expect(analysis.busy).toBe(false);
    expect(importDraft.rows.every((r) => r.counterpartAccountCode === '')).toBe(true);
  });

  test('分類中の reset は分類を取り消す', async () => {
    await load();
    const gate = deferred<unknown>();
    adapterRef.generateJson = () => gate.promise;
    const running = importDraft.runClassify(await prepare());
    importDraft.reset();
    expect(analysis.isCancelling('classify')).toBe(true);
    gate.resolve(SUGGEST_ALL);
    await running;
    expect(importDraft.rows).toEqual([]);
  });
});
