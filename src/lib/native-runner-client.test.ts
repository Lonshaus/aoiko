import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { db } from '../db/db';
import type { Account } from '../db/types';
import { describeLlmError, isAbortError } from '../domain/llm';
import { m } from '../paraglide/messages';
import { setLocale } from '../paraglide/runtime';
import { buildRunnerScript, createVmBridge, type VmReply } from '../native-runner/vm-bridge';
import { createOrderExtractor } from './order-extractor';
import { createReceiptExtractor } from './receipt-extractor';
import {
  orderFromRunner,
  receiptFromRunner,
  runClassifyInRunner,
  runReceiptInRunner,
  runnerConfig,
  type RunnerClassifyGroup,
  type RunnerConfig,
} from './native-runner-client';
import { setSetting } from './settings';
// このプロジェクトは __NATIVE__ = true。web view の外で走らせる環境かどうかは、橋渡しに runAnalysis があるかで決まる。
let script = '';

beforeAll(async () => {
  script = await buildRunnerScript();
}, 120_000);

const BASE = 'http://127.0.0.1:41741/v1';
const HOST = '127.0.0.1:41741';
const IMAGE = { base64: 'iVBORw0KGgo=', mimeType: 'image/png' };
const OPENAI: RunnerConfig = {
  engine: 'openai-compatible',
  model: 'qwen',
  apiKey: 'sk-test',
  baseUrl: BASE,
};

function installBridge(bridge: Record<string, unknown> | undefined): void {
  vi.stubGlobal('window', { ...window, __aoikoNative: bridge });
}

async function useOpenAi(baseUrl: string = BASE): Promise<void> {
  await setSetting('aiEngine', 'openai-compatible');
  await setSetting('openaiBaseUrl', baseUrl);
  await setSetting('openaiOcrModel', 'qwen-vl');
  await setSetting('openaiClassifyModel', 'qwen');
  await setSetting('openaiApiKey', 'sk-test');
}

function openaiReply(content: unknown): VmReply {
  return {
    status: 200,
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  };
}

function stubFetch(answer: () => VmReply): void {
  vi.stubGlobal('fetch', async () => {
    const reply = answer();
    if (reply === 'fail') {
      throw new TypeError('Load failed');
    }
    return new Response(reply.body, { status: reply.status });
  });
}
// 結果を決め打ちで返す橋渡し。
function cannedBridge(take: unknown, start: () => Promise<void> = async () => {}) {
  const calls = {
    run: vi.fn(async (_spec: unknown) => start()),
    take: vi.fn(async (_job: string) => take),
    cancel: vi.fn(async (_job: string) => {}),
  };
  installBridge({
    runAnalysis: calls.run,
    takeAnalysis: calls.take,
    cancelAnalysis: calls.cancel,
  });
  return calls;
}

const RECEIPT = {
  date: '2026-09-30',
  vendorName: 'テスト商店',
  totalAmount: '¥1,320',
  items: [{ description: 'ノート', amount: '1,320' }],
  taxRate: 0.1,
};

const ORDER = {
  date: '2026-10-01',
  vendor: 'Amazon.co.jp',
  items: [
    { description: '本', amount: '1,500' },
    { description: 'クーポン', amount: '-300' },
  ],
  totalAmount: '1200',
};

beforeEach(async () => {
  setLocale('ja', { reload: false });
  await db.settings.clear();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await db.settings.clear();
});

describe('どちらの経路を使うか', () => {
  test('iOS の橋渡しがあり、エンジンが LLM か OS の AI のときだけ runner を使う', () => {
    const gemini: RunnerConfig = { engine: 'gemini', model: 'g', apiKey: 'k' };
    installBridge(undefined);
    expect(runnerConfig(OPENAI)).toBeNull();
    installBridge({ notificationStatus: async () => 'granted', notifyAnalysis: async () => {} });
    expect(runnerConfig(OPENAI)).toBeNull();
    installBridge({ runAnalysis: async () => {} });
    expect(runnerConfig(OPENAI)).toBeNull();
    cannedBridge({ outcome: 'cancelled' });
    expect(runnerConfig(OPENAI)).toBe(OPENAI);
    expect(runnerConfig(gemini)).toBe(gemini);
    expect(runnerConfig({ engine: 'apple-ai' })).toEqual({ engine: 'apple-ai' });
    expect(runnerConfig({ engine: 'chrome-ai' })).toBeNull();
  });

  test('橋渡しが無ければ、抽出器は従来の経路で送る', async () => {
    await useOpenAi();
    installBridge({ notificationStatus: async () => 'granted' });
    stubFetch(() => openaiReply(RECEIPT));
    const extractor = await createReceiptExtractor('ai', 'tesseract');
    const result = await extractor.extract(IMAGE);
    expect(result.totalAmount).toBe('1320');
  });
});

describe('送る仕様', () => {
  test('項目は決まったものだけで、通知の設定と言語は開始時の値', async () => {
    await useOpenAi();
    await setSetting('analysisNotifyEnabled', true);
    setLocale('en', { reload: false });
    const calls = cannedBridge({
      outcome: 'done',
      result: {
        ...RECEIPT,
        totalAmount: '1320',
        items: [{ description: 'ノート', amount: '1320' }],
      },
    });
    const extractor = await createReceiptExtractor('ai', 'tesseract');
    await extractor.extract(IMAGE);
    const spec = calls.run.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(spec).sort()).toEqual([
      'adapter',
      'engine',
      'input',
      'job',
      'kind',
      'locale',
      'notify',
    ]);
    expect(spec).toMatchObject({
      kind: 'receipt',
      engine: 'openai-compatible',
      locale: 'en',
      notify: true,
      adapter: { model: 'qwen-vl', apiKey: 'sk-test', baseUrl: BASE },
      input: { image: IMAGE },
    });
    expect(Object.keys(spec.adapter as object).sort()).toEqual(['apiKey', 'baseUrl', 'model']);
    expect(spec.job).toMatch(/^[A-Za-z0-9-]{1,128}$/);
    expect(calls.take).toHaveBeenCalledWith(spec.job);
  });

  test('Gemini の仕様は baseUrl を持たない', async () => {
    await setSetting('aiEngine', 'gemini');
    await setSetting('geminiApiKey', 'AIza-test');
    await setSetting('geminiModel', 'gemini-2.5-flash');
    const calls = cannedBridge({
      outcome: 'done',
      result: { ...ORDER, items: [{ description: '本', amount: '1200' }] },
    });
    const extractor = await createOrderExtractor();
    await extractor.extract('x');
    const spec = calls.run.mock.calls[0]?.[0] as {
      adapter: object;
      engine: string;
      notify: boolean;
    };
    expect(spec.engine).toBe('gemini');
    expect(spec.notify).toBe(false);
    expect(spec.adapter).toEqual({ model: 'gemini-2.5-flash', apiKey: 'AIza-test' });
  });

  test('抽出器を作ったあとに設定が変わっても、作ったときの値と確認した宛先で送る', async () => {
    await useOpenAi();
    const calls = cannedBridge({
      outcome: 'done',
      result: { ...ORDER, items: [{ description: '本', amount: '1200' }] },
    });
    const extractor = await createOrderExtractor();
    await useOpenAi('https://evil.example/v1');
    await setSetting('openaiClassifyModel', 'other');
    await setSetting('openaiApiKey', 'sk-other');
    await extractor.extract('x');
    const spec = calls.run.mock.calls[0]?.[0] as {
      adapter: { baseUrl: string; model: string; apiKey: string };
    };
    expect(spec.adapter).toEqual({ model: 'qwen', apiKey: 'sk-test', baseUrl: BASE });
    expect(new URL(spec.adapter.baseUrl).host).toBe(extractor.destinationHost);
  });

  test('確認した宛先と食い違う設定では開始の命令を送らない', async () => {
    const calls = cannedBridge({ outcome: 'cancelled' });
    await expect(runReceiptInRunner(OPENAI, 'other.example', IMAGE)).rejects.toThrow(
      m.runner_start_failed(),
    );
    await expect(
      runReceiptInRunner({ engine: 'gemini', model: 'g', apiKey: 'k' }, HOST, IMAGE),
    ).rejects.toThrow(m.runner_start_failed());
    expect(calls.run).not.toHaveBeenCalled();
  });
});

describe('取消し', () => {
  test('ジョブの signal を止めると cancelAnalysis を 1 度だけ呼び、待つのをやめる', async () => {
    const calls = cannedBridge(undefined);
    calls.take.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const running = runReceiptInRunner(OPENAI, HOST, IMAGE, { signal: controller.signal });
    await vi.waitFor(() => expect(calls.take).toHaveBeenCalled());
    controller.abort();
    controller.abort();
    const error = await running.catch((e: unknown) => e);
    expect(isAbortError(error)).toBe(true);
    expect(calls.cancel).toHaveBeenCalledTimes(1);
    expect(calls.cancel).toHaveBeenCalledWith(calls.take.mock.calls[0]?.[0]);
  });

  test('開始の応答を待つ間に止めても、開始のあとで取り消す', async () => {
    let started: () => void = () => {};
    const calls = cannedBridge(
      { outcome: 'cancelled' },
      () =>
        new Promise<void>((resolve) => {
          started = resolve;
        }),
    );
    const controller = new AbortController();
    const running = runReceiptInRunner(OPENAI, HOST, IMAGE, { signal: controller.signal });
    await vi.waitFor(() => expect(calls.run).toHaveBeenCalled());
    controller.abort();
    started();
    expect(isAbortError(await running.catch((e: unknown) => e))).toBe(true);
    expect(calls.cancel).toHaveBeenCalledTimes(1);
  });

  test('始める前に止まっていれば何も送らない', async () => {
    const calls = cannedBridge({ outcome: 'cancelled' });
    const controller = new AbortController();
    controller.abort();
    const error = await runReceiptInRunner(OPENAI, HOST, IMAGE, {
      signal: controller.signal,
    }).catch((e: unknown) => e);
    expect(isAbortError(error)).toBe(true);
    expect(calls.run).not.toHaveBeenCalled();
  });
});

describe('開始の拒否', () => {
  test('disallowed-url は従来の経路と同じ文言、start-failed は固定の文言で、take を呼ばない', async () => {
    const base = 'http://192.168.1.2:11434/v1';
    await useOpenAi(base);
    stubFetch(() => 'fail');
    vi.stubGlobal('fetch', async () => {
      // src-init/external-fetch.js が aoiko_fetch の拒否を TypeError へ揃えた形。
      throw new TypeError('許可されていない URL です: http://192.168.1.2');
    });
    const today = await (
      await createReceiptExtractor('ai', 'tesseract')
    )
      .extract(IMAGE)
      .catch((e: unknown) => e);
    for (const [code, expected] of [
      ['disallowed-url', describeLlmError(today)],
      ['start-failed', m.runner_start_failed()],
      ['something else', m.runner_start_failed()],
    ] as const) {
      const calls = cannedBridge({ outcome: 'cancelled' }, async () => {
        throw code;
      });
      const extractor = await createReceiptExtractor('ai', 'tesseract');
      const error = await extractor.extract(IMAGE).catch((e: unknown) => e);
      expect(describeLlmError(error)).toBe(expected);
      expect(calls.take).not.toHaveBeenCalled();
    }
    expect(describeLlmError(today)).toBe(
      '192.168.1.2:11434 への接続に失敗しました（ローカル LLM サーバ起動・CORS 設定を確認）：許可されていない URL です: http://192.168.1.2',
    );
  });

  test('Gemini の disallowed-url は start-failed と同じ扱い', async () => {
    cannedBridge({ outcome: 'cancelled' }, async () => {
      throw 'disallowed-url';
    });
    const error = await runReceiptInRunner(
      { engine: 'gemini', model: 'g', apiKey: 'k' },
      'generativelanguage.googleapis.com',
      IMAGE,
    ).catch((e: unknown) => e);
    expect(describeLlmError(error)).toBe(m.runner_start_failed());
  });
});
// 同じ応答を、従来の経路（橋渡し無し）と runner の経路（束ねた runner.js を vm で）へ流して比べる。
async function bothPaths(
  kind: 'receipt' | 'order',
  answer: () => VmReply,
): Promise<{ today: unknown; runner: unknown }> {
  installBridge(undefined);
  stubFetch(answer);
  const run = async () => {
    if (kind === 'receipt') {
      return (await createReceiptExtractor('ai', 'tesseract')).extract(IMAGE);
    }
    return (await createOrderExtractor()).extract('注文本文');
  };
  const today = await run().catch((e: unknown) => e);
  const vmBridge = createVmBridge(script, async () => answer());
  installBridge(vmBridge.bridge);
  const runner = await run().catch((e: unknown) => e);
  expect(vmBridge.specs).toHaveLength(1);
  return { today, runner };
}

describe('両経路で同じ結果と同じ文言', () => {
  test.each(['receipt', 'order'] as const)('%s の結果', async (kind) => {
    await useOpenAi();
    const { today, runner } = await bothPaths(kind, () =>
      openaiReply(kind === 'receipt' ? RECEIPT : ORDER),
    );
    expect(today).not.toBeInstanceOf(Error);
    expect(runner).toEqual(today);
  });

  test.each([
    [401, '{"error":"bad key"}'],
    [403, 'forbidden'],
    [404, 'no model'],
    [429, 'slow down'],
    [500, 'down'],
    [503, ''],
  ])('HTTP %i', async (status, body) => {
    await useOpenAi();
    for (const kind of ['receipt', 'order'] as const) {
      const { today, runner } = await bothPaths(kind, () => ({ status, body }));
      expect(describeLlmError(runner)).toBe(describeLlmError(today));
    }
  });

  test('JSON でない応答', async () => {
    await useOpenAi();
    const { today, runner } = await bothPaths('order', () => ({
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: 'not json' } }] }),
    }));
    expect(describeLlmError(runner)).toBe(describeLlmError(today));
  });

  test('通信の失敗（オンライン）：従来の文言から環境の理由を除いたもの', async () => {
    await useOpenAi();
    const { today, runner } = await bothPaths('receipt', () => 'fail');
    const narrowed = `${HOST} への接続に失敗しました（ローカル LLM サーバ起動・CORS 設定を確認）`;
    expect(describeLlmError(today)).toBe(`${narrowed}：Load failed`);
    expect(describeLlmError(runner)).toBe(narrowed);
    await setSetting('aiEngine', 'gemini');
    await setSetting('geminiApiKey', 'AIza-test');
    await setSetting('geminiModel', 'gemini-2.5-flash');
    const gemini = await bothPaths('order', () => 'fail');
    expect(describeLlmError(gemini.runner)).toBe(m.error_gemini_connection_failed());
  });

  test('通信の失敗（オフライン）', async () => {
    await useOpenAi();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { today, runner } = await bothPaths('order', () => 'fail');
    expect(describeLlmError(today)).toBe(m.common_offline_error());
    expect(describeLlmError(runner)).toBe(m.common_offline_error());
  });
});

describe('戻ってきた結果の検査', () => {
  test.each<[unknown, () => string]>([
    [{ outcome: 'failed', error: { code: 'expired' } }, () => m.runner_expired()],
    [{ outcome: 'failed', error: { code: 'invalid-result' } }, () => m.runner_invalid_result()],
    [{ outcome: 'failed', error: { code: 'error', message: '素の文言' } }, () => '素の文言'],
    [{ outcome: 'done', result: [] }, () => m.runner_invalid_result()],
    [{ outcome: 'done' }, () => m.runner_invalid_result()],
    [{ outcome: 'weird' }, () => m.runner_invalid_result()],
    ['done', () => m.runner_invalid_result()],
    [
      { outcome: 'failed', error: { code: 'llm', message: 'x', status: '401' } },
      () => m.runner_invalid_result(),
    ],
    [
      { outcome: 'failed', error: { code: 'connection', detail: 'x' } },
      () => m.runner_invalid_result(),
    ],
  ])('%j', async (take, expected) => {
    cannedBridge(take);
    const error = await runReceiptInRunner(OPENAI, HOST, IMAGE).catch((e: unknown) => e);
    expect(describeLlmError(error)).toBe(expected());
  });

  test('llm は status 付きの LlmError として従来と同じ説明になる', async () => {
    cannedBridge({
      outcome: 'failed',
      error: { code: 'llm', message: 'LLM API エラー 401: x', status: 401 },
    });
    const error = await runReceiptInRunner(OPENAI, HOST, IMAGE).catch((e: unknown) => e);
    expect(describeLlmError(error)).toBe(
      m.llm_error_auth({ status: 401, detail: 'LLM API エラー 401: x' }),
    );
  });

  const goodReceipt = {
    date: '2026-09-30',
    vendorName: 'v',
    totalAmount: '1320',
    items: [{ description: 'a', amount: '-20' }],
  };

  test('受け取れるレシートは新しいオブジェクトへ組み直す', () => {
    const full = {
      ...goodReceipt,
      taxAmount: '120',
      taxRate: 0.1,
      invoiceNumber: 'T1234567890123',
      notes: 'n',
    };
    const parsed = receiptFromRunner(full);
    expect(parsed).toEqual(full);
    expect(parsed).not.toBe(full);
  });

  test.each([
    ['余計な項目', { ...goodReceipt, extra: 1 }],
    [
      '__proto__',
      JSON.parse(
        '{"date":"2026-09-30","vendorName":"v","totalAmount":"1","items":[],"__proto__":{"x":1}}',
      ),
    ],
    ['数値の合計', { ...goodReceipt, totalAmount: 1320 }],
    ['金額でない合計', { ...goodReceipt, totalAmount: '1,320' }],
    ['日付の形', { ...goodReceipt, date: '2026/09/30' }],
    ['負の税率', { ...goodReceipt, taxRate: -1 }],
    ['1 を超える税率', { ...goodReceipt, taxRate: 1.5 }],
    ['登録番号の形', { ...goodReceipt, invoiceNumber: 'T123' }],
    ['空の備考', { ...goodReceipt, notes: '' }],
    ['品目の余計な項目', { ...goodReceipt, items: [{ description: 'a', amount: '1', x: 1 }] }],
    ['品目の金額', { ...goodReceipt, items: [{ description: 'a', amount: 1 }] }],
    ['配列', [goodReceipt]],
  ])('レシート：%s は受け取らない', (_name, value) => {
    expect(receiptFromRunner(value)).toBeNull();
  });

  test.each([
    ['品目が空', { ...ORDER, totalAmount: '1200', items: [] }],
    ['負の合計', { ...ORDER, totalAmount: '-1', items: [{ description: 'a', amount: '1' }] }],
    [
      '空の注文番号',
      { ...ORDER, totalAmount: '1', items: [{ description: 'a', amount: '1' }], orderNumber: '' },
    ],
    [
      '余計な項目',
      { ...ORDER, totalAmount: '1', items: [{ description: 'a', amount: '1' }], x: 1 },
    ],
  ])('注文：%s は受け取らない', (_name, value) => {
    expect(orderFromRunner(value)).toBeNull();
  });
});

describe('分類', () => {
  const candidates = [
    { code: '5200', year: 2026, name: '消耗品費', category: 'expense', displayOrder: 1 },
  ] as Account[];
  const groups: RunnerClassifyGroup[] = [
    {
      knownSide: 'credit',
      inputs: [{ ref: '0', description: 'a', amount: '1' }],
      knownAccountCode: '1130',
      candidateAccounts: candidates,
    },
    {
      knownSide: 'debit',
      inputs: [{ ref: '1', description: 'b', amount: '2' }],
      knownAccountCode: '1130',
      candidateAccounts: candidates,
    },
  ];
  const ok = (ref: string) => ({ ref, accountCode: '5200', confidence: 'high' });

  test('科目はプロンプトが使う項目だけを写して送る', async () => {
    const calls = cannedBridge({
      outcome: 'done',
      result: { suggestions: [[ok('0')], [ok('1')]] },
    });
    const result = await runClassifyInRunner(OPENAI, HOST, groups, new AbortController().signal);
    expect(result).toEqual({ kind: 'done', groups: [[ok('0')], [ok('1')]] });
    const spec = calls.run.mock.calls[0]?.[0] as {
      input: { groups: { options: { candidateAccounts: object[] } }[] };
    };
    expect(spec.input.groups[0]?.options.candidateAccounts).toEqual([
      { code: '5200', name: '消耗品費', category: 'expense' },
    ]);
  });

  test.each([
    ['送っていない ref', [[{ ...ok('0'), ref: '9' }], [ok('1')]]],
    ['別のグループの ref', [[ok('1')], [ok('1')]]],
    ['候補に無い科目', [[{ ...ok('0'), accountCode: '9999' }], [ok('1')]]],
    ['ref の重複', [[ok('0'), ok('0')], [ok('1')]]],
    ['科目の無い high', [[{ ref: '0', accountCode: null, confidence: 'high' }], [ok('1')]]],
    ['グループの数', [[ok('0')]]],
  ])('%s は invalid-result', async (_name, suggestions) => {
    cannedBridge({ outcome: 'done', result: { suggestions } });
    const result = await runClassifyInRunner(OPENAI, HOST, groups, new AbortController().signal);
    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && describeLlmError(result.error)).toBe(
      m.runner_invalid_result(),
    );
  });

  test('失敗と取消しは、終わっていたグループを partial として返す', async () => {
    cannedBridge({
      outcome: 'failed',
      error: { code: 'llm', message: 'LLM API エラー 500: down', status: 500 },
      partial: [{ group: 0, suggestions: [ok('0')] }],
    });
    const failed = await runClassifyInRunner(OPENAI, HOST, groups, new AbortController().signal);
    expect(failed.kind === 'failed' && failed.partial).toEqual([
      { group: 0, suggestions: [ok('0')] },
    ]);
    cannedBridge({ outcome: 'cancelled', partial: [{ group: 1, suggestions: [ok('1')] }] });
    const cancelled = await runClassifyInRunner(OPENAI, HOST, groups, new AbortController().signal);
    expect(cancelled).toEqual({
      kind: 'cancelled',
      partial: [{ group: 1, suggestions: [ok('1')] }],
    });
    cannedBridge({
      outcome: 'cancelled',
      partial: [
        { group: 1, suggestions: [ok('1')] },
        { group: 0, suggestions: [ok('0')] },
      ],
    });
    const every = await runClassifyInRunner(OPENAI, HOST, groups, new AbortController().signal);
    expect(every).toEqual({
      kind: 'cancelled',
      partial: [
        { group: 0, suggestions: [ok('0')] },
        { group: 1, suggestions: [ok('1')] },
      ],
    });
    cannedBridge({ outcome: 'cancelled', partial: [{ group: 2, suggestions: [] }] });
    const broken = await runClassifyInRunner(OPENAI, HOST, groups, new AbortController().signal);
    expect(broken.kind).toBe('failed');
  });
});
