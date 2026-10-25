import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { db } from '../db/db';
import type { Account } from '../db/types';
import { setSetting } from '../lib/settings';
import type { CsvParser } from '../parsers/types';
import {
  buildRunnerScript,
  createVmBridge,
  type VmReply,
  type VmRequest,
} from '../native-runner/vm-bridge';
// 同じ CSV と同じ LLM の応答を、従来の経路（橋渡し無し）と runner の経路（束ねた runner.js を
// vm で）へ流し、行・件数・状況文言・エラーが同じになることを見る。
const { parser } = vi.hoisted(() => {
  const parser: CsvParser = {
    name: 'parser-sides',
    displayName: 'パーサー',
    accountCode: '1130',
    encoding: 'utf-8',
    // 先頭が + の行は入金（借方）、それ以外は出金（貸方）。
    parse: (text: string) =>
      text.split('\n').map((line, i) => ({
        date: `2026-01-${String(i + 1).padStart(2, '0')}`,
        description: line.replace(/^\+/, ''),
        amount: String((i + 1) * 100),
        side: line.startsWith('+') ? ('debit' as const) : ('credit' as const),
        rawRow: {},
      })),
  };
  return { parser };
});

vi.mock('../parsers', () => ({
  PARSERS: [parser],
  findParser: (name: string) => (name === parser.name ? parser : null),
}));

const { importDraft } = await import('./import-draft.svelte');
const { analysis } = await import('./analysis.svelte');
const { ledger } = await import('./ledger.svelte');

const ACCOUNTS: Account[] = [
  { code: '5200', year: 2026, name: '消耗品費', category: 'expense', displayOrder: 1 },
  { code: '4110', year: 2026, name: '売上高', category: 'revenue', displayOrder: 2 },
];
const LINES = ['文具店', '謎の支払', '+売上入金'];
// 貸方のグループ（借方を問うグループ）と借方のグループで答えを分ける。
const ANSWERS: Record<'credit' | 'debit', unknown> = {
  credit: {
    classifications: [
      { ref: '0', accountCode: '5200', confidence: 'high', reason: '文具' },
      { ref: '1', accountCode: '5200', confidence: 'low' },
    ],
  },
  debit: {
    classifications: [{ ref: '2', accountCode: '4110', confidence: 'high', status: 'failed' }],
  },
};

let script = '';

beforeAll(async () => {
  script = await buildRunnerScript();
}, 120_000);

function sideOf(body: string | undefined): 'credit' | 'debit' {
  return body?.includes('求められる側：借方') ? 'credit' : 'debit';
}

function openaiReply(content: unknown): VmReply {
  return {
    status: 200,
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  };
}

type Answer = (request: VmRequest, call: number) => Promise<VmReply>;

function installBridge(bridge: Record<string, unknown> | undefined): void {
  vi.stubGlobal('window', { ...window, __aoikoNative: bridge });
}
// 従来の経路の fetch。中止されたら標準の fetch と同じく AbortError で抜ける。
function stubFetch(answer: Answer): void {
  let calls = 0;
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls += 1;
    const request: VmRequest = {
      url,
      method: init.method ?? 'GET',
      headers: [],
      body: init.body as string,
    };
    return new Promise((resolve, reject) => {
      init.signal?.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted.', 'AbortError')),
      );
      answer(request, calls).then((reply) => {
        if (reply === 'fail') {
          reject(new TypeError('Load failed'));
          return;
        }
        resolve(new Response(reply.body, { status: reply.status }));
      }, reject);
    });
  });
}

type Snapshot = {
  rows: { code: string; confidence: string; taxRate: number }[];
  llmStatus: string;
  error: string;
  unseen: unknown;
};

function snapshot(): Snapshot {
  return {
    rows: importDraft.rows.map((row) => ({
      code: row.counterpartAccountCode,
      confidence: row.llmConfidence,
      taxRate: row.taxRate,
    })),
    llmStatus: importDraft.llmStatus,
    error: importDraft.error,
    unseen: analysis.unseen.classify,
  };
}

async function run(
  path: 'today' | 'runner',
  answer: Answer,
): Promise<ReturnType<typeof createVmBridge> | null> {
  const loaded = await importDraft.loadFile(new File([LINES.join('\n')], 'a.csv'));
  expect(loaded).toBe('clear-input');
  let vmBridge: ReturnType<typeof createVmBridge> | null = null;
  if (path === 'runner') {
    let calls = 0;
    vmBridge = createVmBridge(script, (request) => {
      calls += 1;
      return answer(request, calls);
    });
    installBridge(vmBridge.bridge);
  } else {
    installBridge(undefined);
    stubFetch(answer);
  }
  const prepared = await importDraft.prepareClassify();
  expect(prepared).not.toBeNull();
  expect(prepared!.runner === null).toBe(path === 'today');
  await importDraft.runClassify(prepared!);
  return vmBridge;
}

function clear(): void {
  importDraft.reset();
  importDraft.llmStatus = '';
  if (analysis.job !== null) {
    analysis.finish(analysis.job, 'cancelled');
  }
  analysis.unseen = {};
  analysis.notices = [];
}

async function bothPaths(answer: Answer): Promise<{ today: Snapshot; runner: Snapshot }> {
  await run('today', answer);
  const today = snapshot();
  clear();
  await run('runner', answer);
  return { today, runner: snapshot() };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  vi.spyOn(ledger, 'accounts', 'get').mockReturnValue(ACCOUNTS);
  importDraft.selectedParserName = parser.name;
  await setSetting('aiEngine', 'openai-compatible');
  await setSetting('openaiBaseUrl', 'http://127.0.0.1:41741/v1');
  await setSetting('openaiClassifyModel', 'qwen');
});

afterEach(async () => {
  clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await db.delete();
});

describe('同じ応答なら両経路で同じ行・件数になる', () => {
  test('2 グループとも答える', async () => {
    const { today, runner } = await bothPaths(async (request) =>
      openaiReply(ANSWERS[sideOf(request.body)]),
    );
    expect(today.rows.map((row) => row.code)).toEqual(['5200', '5200', '']);
    expect(today.llmStatus).not.toBe('');
    expect(today.unseen).toBe('done');
    expect(runner).toEqual(today);
  });

  test('2 つ目のグループの失敗：1 つ目のグループの行は書かれ、状況文言は出ず、同じエラー', async () => {
    const { today, runner } = await bothPaths(async (request) =>
      sideOf(request.body) === 'credit'
        ? openaiReply(ANSWERS.credit)
        : { status: 500, body: 'down' },
    );
    expect(today.rows.map((row) => row.code)).toEqual(['5200', '5200', '']);
    expect(today.llmStatus).toBe('');
    expect(today.error).not.toBe('');
    expect(today.unseen).toBe('failed');
    expect(runner).toEqual(today);
  });

  test.each([
    [401, 'bad key'],
    [429, 'slow'],
  ])('1 つ目のグループで HTTP %i：何も書かれず同じエラー', async (status, body) => {
    const { today, runner } = await bothPaths(async () => ({ status, body }));
    expect(today.rows.map((row) => row.code)).toEqual(['', '', '']);
    expect(runner).toEqual(today);
  });

  test('JSON でない応答', async () => {
    const { today, runner } = await bothPaths(async () => ({
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: 'no' } }] }),
    }));
    expect(today.error).not.toBe('');
    expect(runner).toEqual(today);
  });
});

describe('取消し', () => {
  // 1 つ目のグループが終わり、2 つ目のグループの応答を待っている間に取り消す。
  const cancelOnSecond =
    (action: () => void): Answer =>
    async (request, call) => {
      if (call === 1) {
        return openaiReply(ANSWERS[sideOf(request.body)]);
      }
      queueMicrotask(action);
      return new Promise<VmReply>(() => {});
    };

  test('(a) 取消しの前に終わったグループは、従来の経路と同じく書かれ、状況文言もエラーも出ない', async () => {
    await run(
      'today',
      cancelOnSecond(() => analysis.cancel()),
    );
    const today = snapshot();
    clear();
    const vmBridge = await run(
      'runner',
      cancelOnSecond(() => analysis.cancel()),
    );
    const runner = snapshot();
    expect(today.rows.map((row) => row.code)).toEqual(['5200', '5200', '']);
    expect(today.llmStatus).toBe('');
    expect(today.error).toBe('');
    expect(runner).toEqual(today);
    expect(vmBridge?.cancels).toHaveLength(1);
    expect(analysis.busy).toBe(false);
  });

  test('(c) 取消しが届いたときに全グループが終わっていれば、従来の経路と同じく全グループを書く', async () => {
    await run('today', async (request) => openaiReply(ANSWERS[sideOf(request.body)]));
    const today = snapshot();
    clear();
    const loaded = await importDraft.loadFile(new File([LINES.join('\n')], 'a.csv'));
    expect(loaded).toBe('clear-input');
    let calls = 0;
    const inner = createVmBridge(script, async (request) => {
      calls += 1;
      if (calls === 2) {
        queueMicrotask(() => analysis.cancel());
      }
      return openaiReply(ANSWERS[sideOf(request.body)]);
    });
    // runner.js は取消しの前に全グループを終えている。Rust の complete と同じく、その done を
    // 全グループを partial に持つ取消しとして返す。
    const cancelled: string[] = [];
    installBridge({
      ...inner.bridge,
      async cancelAnalysis(job: string): Promise<void> {
        cancelled.push(job);
      },
      async takeAnalysis(job: string): Promise<unknown> {
        const taken = (await inner.bridge.takeAnalysis(job)) as {
          outcome: string;
          result?: { suggestions?: unknown[] };
        };
        if (!cancelled.includes(job) || taken.outcome !== 'done') {
          return taken;
        }
        const groups = taken.result?.suggestions ?? [];
        return {
          outcome: 'cancelled',
          partial: groups.map((suggestions, group) => ({ group, suggestions })),
        };
      },
    });
    const prepared = await importDraft.prepareClassify();
    expect(prepared?.runner).not.toBeNull();
    await importDraft.runClassify(prepared!);
    expect(cancelled).toHaveLength(1);
    expect(importDraft.rows.map((row) => row.counterpartAccountCode)).toEqual(['5200', '5200', '']);
    expect(snapshot().rows).toEqual(today.rows);
    expect(importDraft.llmStatus).toBe('');
    expect(importDraft.error).toBe('');
    expect(analysis.busy).toBe(false);
  });

  test('(b) reset のあとに届いたグループは書かない', async () => {
    const vmBridge = await run(
      'runner',
      cancelOnSecond(() => importDraft.reset()),
    );
    expect(vmBridge?.cancels).toHaveLength(1);
    expect(importDraft.rows).toEqual([]);
    expect(importDraft.llmStatus).toBe('');
    expect(importDraft.error).toBe('');
  });

  test('(b) ファイルが替わったあとに届いたグループは書かない', async () => {
    const vmBridge = await run(
      'runner',
      cancelOnSecond(() => {
        analysis.cancel();
        importDraft.fileHash = 'f'.repeat(64);
      }),
    );
    expect(vmBridge?.cancels).toHaveLength(1);
    expect(importDraft.rows.map((row) => row.counterpartAccountCode)).toEqual(['', '', '']);
    expect(importDraft.llmStatus).toBe('');
    expect(importDraft.error).toBe('');
  });
});
