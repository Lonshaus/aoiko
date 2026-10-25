import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { GeminiAdapter, OpenAICompatibleAdapter, type LlmAdapter } from '../domain/llm';
import { extractReceipt } from '../domain/ocr';
import { buildOrderPrompt, parseOrderResponse } from '../domain/order-extract';
import { classifyWithLlm } from '../domain/llm-classify';
import type { Account } from '../db/types';
import { setLocale } from '../paraglide/runtime';
import { RUNNER_BANNER } from '../../scripts/build-native-runner.mjs';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import {
  extractFromOcrLayout,
  extractFromOcrText,
  type OcrLayout,
} from '../domain/receipt-text-extract';
import { AppleAiAdapter } from '../lib/apple-ai-adapter';
import { extractReceiptWithAppleAi } from '../lib/ocr/apple-ai-engine';
import { m } from '../paraglide/messages';
import { NATIVE_NO_TEXT_MESSAGE } from '../lib/ocr/native-engine';
import { dirname, resolve } from 'node:path';
import { RUNNER_ENTRY } from '../../scripts/build-native-runner.mjs';
import {
  buildRunnerScript,
  loadRunner,
  type VmLocalHost,
  type VmReply,
  type VmRequest,
} from './vm-bridge';
// dist/ は読まない。テストのたびに同じ設定で束ね直す（クリーンな checkout と CI でも同じに動く）。
let script = '';

beforeAll(async () => {
  script = await buildRunnerScript();
}, 120_000);

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale('ja', { reload: false });
});

const BASE = 'http://127.0.0.1:41741/v1';

function openaiReply(content: unknown): VmReply {
  return {
    status: 200,
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  };
}

function geminiReply(content: unknown): VmReply {
  return {
    status: 200,
    body: JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(content) }] } }],
    }),
  };
}

const RECEIPT = {
  date: '2026-09-30',
  vendorName: 'テスト商店',
  totalAmount: '¥1,320',
  items: [
    { description: 'ノート', amount: '1,200' },
    { description: '袋', amount: '120' },
  ],
  taxAmount: '120',
  taxRate: 0.1,
  invoiceNumber: 'T1234567890123',
  notes: '備考',
};

const ORDER = {
  date: '2026-10-01',
  vendor: 'Amazon.co.jp',
  orderNumber: '250-1',
  items: [
    { description: '本', amount: '1,500' },
    { description: 'クーポン', amount: '-300' },
  ],
  totalAmount: '1200',
};

const CANDIDATES: Pick<Account, 'code' | 'name' | 'category'>[] = [
  { code: '5200', name: '消耗品費', category: 'expense' },
  { code: '4110', name: '売上高', category: 'revenue' },
];

const GROUPS = [
  {
    knownSide: 'credit' as const,
    inputs: [
      { ref: '0', description: '文具店', amount: '1200' },
      { ref: '1', description: '謎の支払', amount: '300' },
    ],
    options: {
      knownAccountCode: '1130',
      knownSide: 'credit' as const,
      candidateAccounts: CANDIDATES,
    },
  },
  {
    knownSide: 'debit' as const,
    inputs: [{ ref: '2', description: '売上入金', amount: '50000' }],
    options: {
      knownAccountCode: '1130',
      knownSide: 'debit' as const,
      candidateAccounts: CANDIDATES,
    },
  },
];

const CLASSIFY_ANSWERS: Record<string, unknown> = {
  credit: {
    classifications: [
      { ref: '0', accountCode: '5200', confidence: 'high', reason: '文具' },
      { ref: '1', accountCode: '9999', confidence: 'low' },
    ],
  },
  debit: { classifications: [{ ref: '2', accountCode: '4110', confidence: 'high' }] },
};

function spec(
  kind: 'receipt' | 'order' | 'classify',
  engine: 'gemini' | 'openai-compatible',
  input: unknown,
  locale: 'ja' | 'en' | 'zh-TW' = 'ja',
) {
  return JSON.stringify({
    job: 'job-1',
    kind,
    engine,
    locale,
    notify: false,
    adapter:
      engine === 'gemini'
        ? { model: 'gemini-2.5-flash', apiKey: 'AIza-test' }
        : { model: 'qwen', apiKey: 'sk-test', baseUrl: BASE },
    input,
  });
}
// domain の関数を直接走らせるときの fetch。vm の中と同じ応答を返し、送ったものを記録する。
function stubFetch(answer: (request: VmRequest) => Promise<VmReply>): VmRequest[] {
  const sent: VmRequest[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const request: VmRequest = {
      url,
      method: init.method ?? 'GET',
      headers: Object.entries(init.headers as Record<string, string>),
      body: init.body as string,
    };
    sent.push(request);
    const reply = await answer(request);
    if (reply === 'fail') {
      throw new TypeError('Load failed');
    }
    return new Response(reply.body, { status: reply.status });
  });
  return sent;
}

function record(answer: (request: VmRequest) => Promise<VmReply>) {
  const sent: VmRequest[] = [];
  return {
    sent,
    answer: async (request: VmRequest) => {
      sent.push(request);
      return answer(request);
    },
  };
}

function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

const IMAGE = { base64: 'iVBORw0KGgo=', mimeType: 'image/png' };

describe('runner.js の束ね方', () => {
  test('先頭に目印があり、Swift が渡すもの以外の大域変数に頼らない', () => {
    expect(script.startsWith(RUNNER_BANNER)).toBe(true);
    const { globals } = loadRunner(script, async () => 'fail');
    for (const absent of [
      'fetch',
      'URL',
      'TextEncoder',
      'TextDecoder',
      'atob',
      'btoa',
      'structuredClone',
      'AbortController',
      'setTimeout',
      'clearTimeout',
      'window',
      'document',
      'navigator',
      'localStorage',
    ]) {
      expect(globals).not.toContain(absent);
    }
  });
});

describe('domain の関数を直接走らせたときと同じ結果になる', () => {
  test.each([
    ['openai-compatible', openaiReply(RECEIPT)],
    ['gemini', geminiReply(RECEIPT)],
  ] as const)('receipt（%s）', async (engine, reply) => {
    const vmSide = record(async () => reply);
    const { runner } = loadRunner(script, vmSide.answer);
    const out = JSON.parse(await runner.run(spec('receipt', engine, { image: IMAGE })));
    const sent = stubFetch(async () => reply);
    const adapter: LlmAdapter =
      engine === 'gemini'
        ? new GeminiAdapter('AIza-test', 'gemini-2.5-flash')
        : new OpenAICompatibleAdapter(BASE, 'qwen', 'sk-test');
    const direct = await extractReceipt(adapter, IMAGE);
    expect(out).toEqual({ outcome: 'done', result: plain(direct) });
    expect(vmSide.sent).toEqual(sent);
  });

  test('order', async () => {
    const vmSide = record(async () => openaiReply(ORDER));
    const { runner } = loadRunner(script, vmSide.answer);
    const out = JSON.parse(
      await runner.run(spec('order', 'openai-compatible', { text: '注文本文' })),
    );
    const sent = stubFetch(async () => openaiReply(ORDER));
    const adapter = new OpenAICompatibleAdapter(BASE, 'qwen', 'sk-test');
    const raw = await adapter.generateJson(
      `${buildOrderPrompt()}\n\n---\n以下が貼り付けテキスト：\n\n注文本文`,
    );
    expect(out).toEqual({ outcome: 'done', result: plain(parseOrderResponse(raw)) });
    expect(vmSide.sent).toEqual(sent);
  });

  test('classify（2 グループ）と進捗', async () => {
    const answer = async (request: VmRequest) =>
      openaiReply(
        CLASSIFY_ANSWERS[request.body?.includes('求められる側：借方') ? 'credit' : 'debit'],
      );
    const progress: [number, number][] = [];
    const vmSide = record(answer);
    const { runner } = loadRunner(script, vmSide.answer, (done, total) =>
      progress.push([done, total]),
    );
    const out = JSON.parse(
      await runner.run(spec('classify', 'openai-compatible', { groups: GROUPS })),
    );
    const sent = stubFetch(answer);
    const adapter = new OpenAICompatibleAdapter(BASE, 'qwen', 'sk-test');
    const direct = [];
    for (const group of GROUPS) {
      direct.push(
        await classifyWithLlm(adapter, group.inputs, {
          ...group.options,
          candidateAccounts: group.options.candidateAccounts as Account[],
        }),
      );
    }
    expect(out).toEqual({ outcome: 'done', result: { suggestions: plain(direct) } });
    expect(vmSide.sent).toEqual(sent);
    expect(progress).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });
});

describe('失敗と取消し', () => {
  test('HTTP 401 は llm（文言と status をそのまま）', async () => {
    const reply: VmReply = { status: 401, body: '{"error":"bad key"}' };
    const { runner } = loadRunner(script, async () => reply);
    const out = JSON.parse(await runner.run(spec('order', 'openai-compatible', { text: 'x' })));
    stubFetch(async () => reply);
    const direct = await new OpenAICompatibleAdapter(BASE, 'qwen', 'sk-test')
      .generateJson('x')
      .catch((e: Error & { status?: number }) => e);
    expect(out).toEqual({
      outcome: 'failed',
      error: { code: 'llm', message: (direct as Error).message, status: 401 },
    });
  });

  test('通信できないときは connection（理由の文字列は持たない）', async () => {
    const { runner } = loadRunner(script, async () => 'fail');
    const out = JSON.parse(await runner.run(spec('receipt', 'gemini', { image: IMAGE })));
    expect(out).toEqual({ outcome: 'failed', error: { code: 'connection' } });
  });

  test('JSON でない応答は llm（ジョブの言語の文言）', async () => {
    const reply: VmReply = {
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: 'not json' } }] }),
    };
    const { runner } = loadRunner(script, async () => reply);
    const ja = JSON.parse(await runner.run(spec('order', 'openai-compatible', { text: 'x' })));
    const en = JSON.parse(
      await runner.run(spec('order', 'openai-compatible', { text: 'x' }, 'en')),
    );
    expect(ja.error.code).toBe('llm');
    expect(ja.error.status).toBeUndefined();
    expect(ja.error.message).not.toBe(en.error.message);
    expect(en.error.message).toMatch(/[A-Za-z]/);
  });

  test('分類の 2 つ目のグループで失敗すると、1 つ目のグループを partial に残す', async () => {
    const { runner } = loadRunner(script, async (request) =>
      request.body?.includes('求められる側：借方')
        ? openaiReply(CLASSIFY_ANSWERS.credit)
        : { status: 500, body: 'down' },
    );
    const out = JSON.parse(
      await runner.run(spec('classify', 'openai-compatible', { groups: GROUPS })),
    );
    expect(out.outcome).toBe('failed');
    expect(out.error).toEqual({ code: 'llm', message: 'LLM API エラー 500: down', status: 500 });
    expect(out.partial).toHaveLength(1);
    expect(out.partial[0].group).toBe(0);
    expect(out.partial[0].suggestions.map((s: { ref: string }) => s.ref)).toEqual(['0', '1']);
  });

  test('通信の途中で abort すると cancelled で終わる', async () => {
    let release: (reply: VmReply) => void = () => {};
    const { runner } = loadRunner(
      script,
      () =>
        new Promise<VmReply>((resolve) => {
          release = resolve;
        }),
    );
    const running = runner.run(spec('order', 'openai-compatible', { text: 'x' }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    runner.abort();
    expect(JSON.parse(await running)).toEqual({ outcome: 'cancelled' });
    release(openaiReply(ORDER));
  });

  test('分類の取消しは、終わっていたグループを partial に残す', async () => {
    let calls = 0;
    const { runner } = loadRunner(script, async () => {
      calls += 1;
      return calls === 1 ? openaiReply(CLASSIFY_ANSWERS.credit) : new Promise<VmReply>(() => {});
    });
    const running = runner.run(spec('classify', 'openai-compatible', { groups: GROUPS }));
    await vi.waitFor(() => expect(calls).toBe(2));
    runner.abort();
    const out = JSON.parse(await running);
    expect(out.outcome).toBe('cancelled');
    expect(out.partial.map((p: { group: number }) => p.group)).toEqual([0]);
  });
});

// 端末内のエンジン。aoikoHost の 6 つの関数を偽物にして、web view の経路と同じ結果・文言になることを見る。
function localSpec(kind: 'receipt' | 'order' | 'classify', engine: string): string {
  const input =
    kind === 'receipt'
      ? { image: IMAGE }
      : kind === 'order'
        ? { text: '注文 1,200 円' }
        : {
            groups: [
              {
                knownSide: 'debit',
                inputs: [{ ref: '0', description: 'コンビニ', amount: '1200' }],
                options: {
                  knownAccountCode: '1130',
                  knownSide: 'debit',
                  candidateAccounts: [{ code: '5200', name: '消耗品費', category: 'expense' }],
                },
              },
            ],
          };
  return JSON.stringify({ job: 'local-1', kind, engine, locale: 'ja', notify: false, input });
}

async function runLocal(spec: string, local: VmLocalHost): Promise<Record<string, unknown>> {
  const { runner } = loadRunner(
    script,
    async () => 'fail',
    () => {},
    local,
  );
  return JSON.parse(await runner.run(spec)) as Record<string, unknown>;
}

async function messageOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return '';
}

const APPLE_RECEIPT = JSON.stringify({
  vendor: 'あおい薬局',
  date: '2026-05-14',
  total: '248',
  invoiceNumber: '1234567890123',
  amount8: '248',
  amount10: '',
  items: [
    { name: '水', amount: '248' },
    { name: '', amount: '1' },
  ],
});

describe('端末内のエンジン', () => {
  test('apple-ai の領収書：従来の対応付けと同じ結果で、画像は橋渡しの引数に頼らない', async () => {
    const extract = vi.fn(async () => APPLE_RECEIPT);
    const out = await runLocal(localSpec('receipt', 'apple-ai'), {
      appleAiAvailability: async () => 0,
      appleAiExtract: extract,
    });
    const today = await extractReceiptWithAppleAi(IMAGE, {
      appleAiAvailability: async () => 0,
      appleAiExtract: async () => APPLE_RECEIPT,
    });
    expect(out).toEqual({ outcome: 'done', result: plain(today) });
    expect(extract).toHaveBeenCalledTimes(1);
  });

  test.each([1, 2, 3, 4, 5])('apple-ai の利用可否 %i は従来と同じ文言', async (code) => {
    const out = await runLocal(localSpec('receipt', 'apple-ai'), {
      appleAiAvailability: async () => code,
    });
    const today = await messageOf(
      extractReceiptWithAppleAi(IMAGE, { appleAiAvailability: async () => code }),
    );
    expect(out).toEqual({ outcome: 'failed', error: { code: 'error', message: today } });
  });

  test.each([1, 2, 3, 4, 5, 6, 7])('apple-ai の抽出のコード %i は従来と同じ文言', async (code) => {
    const out = await runLocal(localSpec('receipt', 'apple-ai'), {
      appleAiAvailability: async () => 0,
      appleAiExtract: () => Promise.reject(code),
    });
    const today = await messageOf(
      extractReceiptWithAppleAi(IMAGE, {
        appleAiAvailability: async () => 0,
        appleAiExtract: () => Promise.reject(code),
      }),
    );
    expect(out).toEqual({ outcome: 'failed', error: { code: 'error', message: today } });
  });

  test('apple-ai の注文取込：runDataTask を通り、従来と同じ結果', async () => {
    const order = {
      date: '2026-10-01',
      vendor: 'Shop',
      items: [{ description: 'A', amount: '1200' }],
      totalAmount: '1200',
    };
    const run = vi.fn(async (_task: number, _data: string) => JSON.stringify(order));
    const out = await runLocal(localSpec('order', 'apple-ai'), { appleAiRun: run });
    const today = parseOrderResponse(
      await new AppleAiAdapter({ appleAiRun: async () => JSON.stringify(order) }).runDataTask(
        'order',
        { text: '注文 1,200 円' },
      ),
    );
    expect(out).toEqual({ outcome: 'done', result: plain(today) });
    expect(run).toHaveBeenCalledWith(2, JSON.stringify({ text: '注文 1,200 円' }));
  });

  test('apple-ai の分類：従来と同じ提案', async () => {
    const answer = {
      classifications: [{ ref: '0', accountCode: '5200', confidence: 'high', reason: 'r' }],
    };
    const run = vi.fn(async (_task: number, _data: string) => JSON.stringify(answer));
    const out = await runLocal(localSpec('classify', 'apple-ai'), { appleAiRun: run });
    const today = await classifyWithLlm(
      new AppleAiAdapter({ appleAiRun: async () => JSON.stringify(answer) }),
      [{ ref: '0', description: 'コンビニ', amount: '1200' }],
      {
        knownAccountCode: '1130',
        knownSide: 'debit',
        candidateAccounts: [{ code: '5200', name: '消耗品費', category: 'expense' }] as Account[],
      },
    );
    expect(out).toEqual({ outcome: 'done', result: { suggestions: [plain(today)] } });
    expect(run.mock.calls[0]?.[0]).toBe(1);
  });

  test.each([1, 2, 3, 4, 5, 6, 7])(
    'apple-ai の分類・注文のコード %i は従来と同じ文言',
    async (code) => {
      for (const kind of ['order', 'classify'] as const) {
        const out = await runLocal(localSpec(kind, 'apple-ai'), {
          appleAiRun: () => Promise.reject(code),
        });
        const today = await messageOf(
          new AppleAiAdapter({ appleAiRun: () => Promise.reject(code) }).runDataTask(kind, {}),
        );
        expect(out).toEqual({ outcome: 'failed', error: { code: 'llm', message: today } });
      }
    },
  );

  test('OS の文字認識：従来と同じ抽出、失敗は 2 つの決まった文言', async () => {
    const layout: OcrLayout = {
      lines: [
        {
          text: '合計 ¥248',
          words: [{ text: '合計 ¥248', x: 0.1, y: 0.5, width: 0.5, height: 0.03 }],
          x: 0.1,
          y: 0.5,
          width: 0.5,
          height: 0.03,
        },
      ],
      text: '合計 ¥248',
    };
    const done = await runLocal(localSpec('receipt', 'native'), {
      recognizeText: async () => layout,
    });
    expect(done).toEqual({ outcome: 'done', result: plain(extractFromOcrLayout(layout)) });
    const noText = await runLocal(localSpec('receipt', 'native'), {
      recognizeText: () => Promise.reject('no-text'),
    });
    expect(noText).toEqual({
      outcome: 'failed',
      error: { code: 'error', message: NATIVE_NO_TEXT_MESSAGE },
    });
    expect(NATIVE_NO_TEXT_MESSAGE).toBe('テキストが見つかりません');
    const failed = await runLocal(localSpec('receipt', 'native'), {
      recognizeText: () => Promise.reject('failed'),
    });
    expect(failed).toEqual({
      outcome: 'failed',
      error: { code: 'error', message: m.runner_text_recognition_failed() },
    });
  });

  test('tesseract：supportsFastBuild でビルドを選び、Wasm とモデルをアセットの名前で受け取る', async () => {
    const repo = resolve(dirname(RUNNER_ENTRY), '..', '..');
    const dist = resolve(repo, 'node_modules', 'tesseract-wasm', 'dist');
    const model = gunzipSync(
      readFileSync(
        resolve(repo, 'node_modules/@tesseract.js-data/jpn/4.0.0_best_int/jpn.traineddata.gz'),
      ),
    );
    const names: string[] = [];
    const white = new Uint8Array(32 * 32 * 4).fill(255);
    const out = await runLocal(localSpec('receipt', 'tesseract'), {
      decodeImage: async () => ({ width: 32, height: 32, rgba: white.buffer }),
      assetBuffer: (name) => {
        names.push(name);
        const bytes =
          name === 'jpn-traineddata' ? model : readFileSync(resolve(dist, `${name}.wasm`));
        return new Uint8Array(bytes).buffer;
      },
    });
    // Node は Wasm SIMD を扱えるので速いほうのビルドを選ぶ。
    expect(names).toEqual(['tesseract-core', 'jpn-traineddata']);
    expect(out).toEqual({ outcome: 'done', result: plain(extractFromOcrText('')) });
  }, 60_000);

  test('tesseract：開始後の失敗は決まった文言の error', async () => {
    const out = await runLocal(localSpec('receipt', 'tesseract'), {
      decodeImage: async () => ({ width: 1, height: 1, rgba: new ArrayBuffer(4) }),
    });
    expect(out).toEqual({
      outcome: 'failed',
      error: { code: 'error', message: m.runner_local_engine_failed() },
    });
  });

  test('端末内のエンジンのジョブは通信しない', async () => {
    const answer = vi.fn(async () => 'fail' as const);
    const { runner } = loadRunner(script, answer, () => {}, {
      appleAiAvailability: async () => 0,
      appleAiExtract: async () => APPLE_RECEIPT,
    });
    await runner.run(localSpec('receipt', 'apple-ai'));
    expect(answer).not.toHaveBeenCalled();
  });
});
