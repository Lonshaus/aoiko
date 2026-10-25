import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { m } from '../paraglide/messages';
import type { AoikoHost, HostReply } from './shims';
// entry.ts は読み込んだ時点で fetch とタイマーを aoikoHost 経由へ差し替える。タイマーはテストの
// 進行に要るので読み込み後に戻し、fetch だけ差し替えたままにする（解析の通信が aoikoHost だけを通ることを見る）。
type Runner = { run(spec: string): Promise<string>; abort(): void };

const requests: {
  request: { url: string; method: string; headers: [string, string][] };
  body: string | undefined;
}[] = [];
const progress: [number, number][] = [];
let answer: (call: number, body: string | undefined) => Promise<HostReply> = async () => ok({});
let runner: Runner;
const originalTimers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
const originalFetch = globalThis.fetch;

function ok(content: unknown): HostReply {
  return {
    meta: JSON.stringify({ status: 200, statusText: 'OK', headers: [] }),
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  };
}

function status(code: number, body: string): HostReply {
  return { meta: JSON.stringify({ status: code, statusText: '', headers: [] }), body };
}

const host: AoikoHost = {
  async fetch(request, body) {
    requests.push({ request: JSON.parse(request), body });
    return answer(requests.length, body);
  },
  setTimeout: () => 0,
  clearTimeout: () => {},
  progress: (done, total) => {
    progress.push([done, total]);
  },
  appleAiAvailability: () => Promise.resolve(4),
  appleAiExtract: () => Promise.reject(4),
  appleAiRun: () => Promise.reject(4),
  recognizeText: () => Promise.reject('failed'),
  decodeImage: () => Promise.reject(new Error('no image')),
  assetBuffer: () => {
    throw new Error('no asset');
  },
};

beforeAll(async () => {
  (globalThis as unknown as { aoikoHost: AoikoHost }).aoikoHost = host;
  await import('./entry');
  globalThis.setTimeout = originalTimers.setTimeout;
  globalThis.clearTimeout = originalTimers.clearTimeout;
  runner = (globalThis as unknown as { aoikoRunner: Runner }).aoikoRunner;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  requests.length = 0;
  progress.length = 0;
  answer = async () => ok({});
});

const BASE = 'http://127.0.0.1:41741/v1';
const CANDIDATES = [{ code: '5200', name: '消耗品費', category: 'expense' }];

function spec(kind: string, input: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    job: 'j-1',
    kind,
    engine: 'openai-compatible',
    locale: 'ja',
    notify: false,
    adapter: { model: 'qwen', apiKey: 'sk', baseUrl: BASE },
    input,
    ...extra,
  });
}

function group(side: 'debit' | 'credit', ref: string) {
  return {
    knownSide: side,
    inputs: [{ ref, description: `d${ref}`, amount: '100' }],
    options: { knownAccountCode: '1130', knownSide: side, candidateAccounts: CANDIDATES },
  };
}

async function run(value: string): Promise<Record<string, unknown>> {
  return JSON.parse(await runner.run(value)) as Record<string, unknown>;
}

describe('種類ごとの振り分け', () => {
  test('receipt は画像を 1 回送り、抽出結果を返す', async () => {
    answer = async () =>
      ok({ date: '2026-10-01', vendorName: 'v', totalAmount: '1,000', items: [] });
    const out = await run(spec('receipt', { image: { base64: 'AA==', mimeType: 'image/png' } }));
    expect(out).toEqual({
      outcome: 'done',
      result: { date: '2026-10-01', vendorName: 'v', totalAmount: '1000', items: [] },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.request.url).toBe(`${BASE}/chat/completions`);
    expect(requests[0]?.body).toContain('data:image/png;base64,AA==');
    expect(progress).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });

  test('order は貼り付けた本文を送る', async () => {
    answer = async () =>
      ok({ date: '', vendor: 'S', items: [{ description: 'a', amount: '1' }], totalAmount: '1' });
    const out = await run(spec('order', { text: '本文 X' }));
    expect(out.outcome).toBe('done');
    expect(requests[0]?.body).toContain('本文 X');
  });

  test('classify はグループごとに 1 回ずつ送り、グループの順に提案を返す', async () => {
    answer = async (_call, body) =>
      ok({
        classifications: [
          {
            ref: body?.includes('ref=\\"0\\"') ? '0' : '1',
            accountCode: '5200',
            confidence: 'high',
          },
        ],
      });
    const out = await run(
      spec('classify', { groups: [group('credit', '0'), group('debit', '1')] }),
    );
    expect(requests).toHaveLength(2);
    expect(out).toEqual({
      outcome: 'done',
      result: {
        suggestions: [
          [{ ref: '0', accountCode: '5200', confidence: 'high' }],
          [{ ref: '1', accountCode: '5200', confidence: 'high' }],
        ],
      },
    });
    expect(progress).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });

  test('gemini は固定の宛先へ鍵付きで送る', async () => {
    answer = async () => ({
      meta: JSON.stringify({ status: 200, headers: [] }),
      body: JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"totalAmount":"5","items":[]}' }] } }],
      }),
    });
    const out = await run(
      spec(
        'receipt',
        { image: { base64: 'AA==', mimeType: 'image/png' } },
        { engine: 'gemini', adapter: { model: 'gemini-2.5-flash', apiKey: 'AIza k' } },
      ),
    );
    expect(out.outcome).toBe('done');
    expect(requests[0]?.request.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=AIza%20k',
    );
  });
});

describe('失敗のコード', () => {
  test('HTTP エラーは llm（status 付き）', async () => {
    answer = async () => status(429, 'slow');
    expect(await run(spec('order', { text: 'x' }))).toEqual({
      outcome: 'failed',
      error: { code: 'llm', message: 'LLM API エラー 429: slow', status: 429 },
    });
  });

  test('形の違う応答は llm（status 無し）で、ジョブの言語の文言', async () => {
    answer = async () => status(200, '{}');
    const ja = await run(spec('order', { text: 'x' }));
    const en = await run(spec('order', { text: 'x' }, { locale: 'en' }));
    expect(ja).toEqual({
      outcome: 'failed',
      error: { code: 'llm', message: m.error_llm_response_shape({}, { locale: 'ja' }) },
    });
    expect(en).toEqual({
      outcome: 'failed',
      error: { code: 'llm', message: m.error_llm_response_shape({}, { locale: 'en' }) },
    });
    expect(ja).not.toEqual(en);
  });

  test('aoikoHost の通信失敗は connection（文字列を持たない）', async () => {
    answer = async () => {
      throw new Error('detail');
    };
    expect(await run(spec('order', { text: 'x' }))).toEqual({
      outcome: 'failed',
      error: { code: 'connection' },
    });
  });

  test('読めない仕様は error', async () => {
    const out = await run('{not json');
    expect(out.outcome).toBe('failed');
    expect((out.error as { code: string }).code).toBe('error');
  });

  test('分類の途中の失敗は終わったグループを partial に残し、分類以外は partial を持たない', async () => {
    answer = async (call) =>
      call === 1
        ? ok({ classifications: [{ ref: '0', accountCode: '5200', confidence: 'high' }] })
        : status(500, 'down');
    const out = await run(
      spec('classify', { groups: [group('credit', '0'), group('debit', '1')] }),
    );
    expect(out).toEqual({
      outcome: 'failed',
      error: { code: 'llm', message: 'LLM API エラー 500: down', status: 500 },
      partial: [{ group: 0, suggestions: [{ ref: '0', accountCode: '5200', confidence: 'high' }] }],
    });
    answer = async () => status(500, 'down');
    expect(await run(spec('order', { text: 'x' }))).not.toHaveProperty('partial');
  });
});

describe('取消し', () => {
  test('abort は待っている通信を抜けさせ、cancelled で返す', async () => {
    answer = () => new Promise<HostReply>(() => {});
    const running = runner.run(spec('order', { text: 'x' }));
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    runner.abort();
    expect(JSON.parse(await running)).toEqual({ outcome: 'cancelled' });
  });

  test('分類の取消しは終わったグループを partial に残す', async () => {
    answer = (call) =>
      call === 1
        ? Promise.resolve(
            ok({ classifications: [{ ref: '0', accountCode: '5200', confidence: 'low' }] }),
          )
        : new Promise<HostReply>(() => {});
    const running = runner.run(
      spec('classify', { groups: [group('credit', '0'), group('debit', '1')] }),
    );
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    runner.abort();
    expect(JSON.parse(await running)).toEqual({
      outcome: 'cancelled',
      partial: [{ group: 0, suggestions: [{ ref: '0', accountCode: '5200', confidence: 'low' }] }],
    });
  });

  test('ジョブの外での abort は何もしない', () => {
    expect(() => runner.abort()).not.toThrow();
  });
});
