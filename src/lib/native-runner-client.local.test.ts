import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { db } from '../db/db';
import { isAbortError } from '../domain/llm';
import type { ReceiptExtracted } from '../domain/ocr';
import {
  extractFromOcrLayout,
  extractFromOcrText,
  type OcrLayout,
} from '../domain/receipt-text-extract';
import { m } from '../paraglide/messages';
import { setLocale } from '../paraglide/runtime';
import { createLlmAdapterWithConfig } from './llm-adapter';
import { extractReceiptWithAppleAi } from './ocr/apple-ai-engine';
import { localReceiptFromRunner, runReceiptInRunner } from './native-runner-client';
import { createOrderExtractor } from './order-extractor';
import { createReceiptExtractor } from './receipt-extractor';
import { setSetting } from './settings';
// 端末内のエンジン（tesseract・OS の文字認識・OS の AI）を web view の外の実行環境で走らせる側。
// tesseract の web view の経路は worker を使うので、ここでは同じ engine を名乗る偽物に差し替える。
const tesseractExtract = vi.fn(async (): Promise<ReceiptExtracted> => TESSERACT_WEBVIEW);

vi.mock('./ocr/tesseract-engine', () => ({
  createTesseractReceiptExtractor: () => ({
    external: false,
    destinationHost: '',
    downscale: false,
    engine: 'tesseract',
    extract: tesseractExtract,
  }),
}));

const TESSERACT_WEBVIEW: ReceiptExtracted = {
  date: '2026-05-14',
  vendorName: '',
  totalAmount: '248',
  items: [],
  notes: 'web view',
};

const IMAGE = { base64: 'iVBORw0KGgo=', mimeType: 'image/png' };

const LAYOUT: OcrLayout = {
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

type Calls = {
  run: ReturnType<typeof vi.fn>;
  take: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  recognize: ReturnType<typeof vi.fn>;
  extract: ReturnType<typeof vi.fn>;
};
// web view の外で走らせる環境の橋渡し。runAnalysis の答えと、web view の経路の関数（recognizeText 等）を持つ。
function installBridge(
  start: (spec: Record<string, unknown>) => Promise<void>,
  take: unknown = { outcome: 'cancelled' },
): Calls {
  const calls: Calls = {
    run: vi.fn(start),
    take: vi.fn(async () => take),
    cancel: vi.fn(async () => {}),
    recognize: vi.fn(async () => LAYOUT),
    extract: vi.fn(async () => JSON.stringify(APPLE)),
  };
  vi.stubGlobal('window', {
    ...window,
    __aoikoNative: {
      runAnalysis: calls.run,
      takeAnalysis: calls.take,
      cancelAnalysis: calls.cancel,
      recognizeText: calls.recognize,
      appleAiAvailability: async () => 0,
      appleAiExtract: calls.extract,
    },
  });
  return calls;
}

const APPLE = {
  vendor: 'あおい薬局',
  date: '2026-05-14',
  total: '248',
  invoiceNumber: '',
  amount8: '',
  amount10: '',
  items: [{ name: '水', amount: '248' }],
};

const useWebview = () => Promise.reject('use-webview');

beforeEach(async () => {
  setLocale('ja', { reload: false });
  await db.settings.clear();
  tesseractExtract.mockClear();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await db.settings.clear();
});

describe('エンジンの選び方は従来と同じ', () => {
  const cases: [string, 'ai' | 'rule', string, string | undefined][] = [
    ['rule・tesseract', 'rule', 'tesseract', undefined],
    ['rule・native', 'rule', 'native', undefined],
    ['rule・未知の値は既定（native）', 'rule', 'xyz', undefined],
    ['ai・apple-ai', 'ai', 'tesseract', 'apple-ai'],
  ];
  test.each(cases)(
    '%s：同じエンジン・送信先で、仕様の engine もそれ',
    async (_, method, rule, ai) => {
      if (ai !== undefined) {
        await setSetting('aiEngine', ai as 'apple-ai');
      }
      vi.stubGlobal('window', { ...window, __aoikoNative: undefined });
      const today = await createReceiptExtractor(method, rule as 'tesseract');
      const calls = installBridge(async () => {}, { outcome: 'done', result: TESSERACT_WEBVIEW });
      const runner = await createReceiptExtractor(method, rule as 'tesseract');
      expect({ ...runner, extract: null }).toEqual({ ...today, extract: null });
      await runner.extract(IMAGE);
      const spec = calls.run.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(Object.keys(spec).sort()).toEqual([
        'engine',
        'input',
        'job',
        'kind',
        'locale',
        'notify',
      ]);
      expect(spec.engine).toBe(today.engine);
      expect(spec.kind).toBe('receipt');
      expect(spec.input).toEqual({ image: IMAGE });
    },
  );

  test.each(['chrome-ai', 'unknown-engine'])('ai・%s は従来と同じく拒否する', async (engine) => {
    await setSetting('aiEngine', engine as 'chrome-ai');
    vi.stubGlobal('window', { ...window, __aoikoNative: undefined });
    const today = await createReceiptExtractor('ai', 'tesseract').catch((e: Error) => e.message);
    installBridge(async () => {});
    const runner = await createReceiptExtractor('ai', 'tesseract').catch((e: Error) => e.message);
    expect(runner).toBe(today);
  });

  test('注文取込と分類は apple-ai のとき runner を使い、adapter を送らない', async () => {
    await setSetting('aiEngine', 'apple-ai');
    const { config } = await createLlmAdapterWithConfig('classify');
    expect(config).toEqual({ engine: 'apple-ai' });
    const calls = installBridge(async () => {}, {
      outcome: 'done',
      result: {
        date: '2026-10-01',
        vendor: 'S',
        items: [{ description: 'A', amount: '1' }],
        totalAmount: '1',
      },
    });
    const order = await createOrderExtractor();
    expect(order.external).toBe(false);
    expect(order.destinationHost).toBe('');
    await order.extract('注文');
    const spec = calls.run.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(spec.engine).toBe('apple-ai');
    expect(spec.kind).toBe('order');
    expect('adapter' in spec).toBe(false);
  });
});

describe("'use-webview' は準備した同じ抽出器で読む", () => {
  test('tesseract（大きすぎる画像・Wasm が使えない）：従来の抽出器で読み、take は呼ばない', async () => {
    for (let i = 0; i < 2; i += 1) {
      const calls = installBridge(useWebview);
      const extractor = await createReceiptExtractor('rule', 'tesseract');
      await expect(extractor.extract(IMAGE)).resolves.toEqual(TESSERACT_WEBVIEW);
      expect(tesseractExtract).toHaveBeenCalledTimes(i + 1);
      expect(calls.take).not.toHaveBeenCalled();
    }
  });

  test('native と apple-ai：従来の橋渡しで読む', async () => {
    let calls = installBridge(useWebview);
    const native = await createReceiptExtractor('rule', 'native');
    await expect(native.extract(IMAGE)).resolves.toEqual(extractFromOcrLayout(LAYOUT));
    expect(calls.recognize).toHaveBeenCalledWith(IMAGE.base64);
    expect(calls.take).not.toHaveBeenCalled();
    await setSetting('aiEngine', 'apple-ai');
    calls = installBridge(useWebview);
    const apple = await createReceiptExtractor('ai', 'tesseract');
    await expect(apple.extract(IMAGE)).resolves.toEqual(
      await extractReceiptWithAppleAi(IMAGE, {
        appleAiAvailability: async () => 0,
        appleAiExtract: async () => JSON.stringify(APPLE),
      }),
    );
    expect(calls.extract).toHaveBeenCalledTimes(1);
    expect(calls.take).not.toHaveBeenCalled();
  });

  test('準備の後に設定を変えても、準備したエンジンで読む', async () => {
    const calls = installBridge(useWebview);
    const extractor = await createReceiptExtractor('rule', 'native');
    await setSetting('aiEngine', 'gemini');
    await setSetting('geminiApiKey', 'k');
    await setSetting('geminiModel', 'g');
    await extractor.extract(IMAGE);
    expect(calls.run.mock.calls[0]?.[0]).toMatchObject({ engine: 'native' });
    expect(calls.recognize).toHaveBeenCalledTimes(1);
    expect(tesseractExtract).not.toHaveBeenCalled();
  });

  test('開始の間に取り消されたら、web view の抽出器も take も呼ばない', async () => {
    const controller = new AbortController();
    const calls = installBridge(async () => {
      controller.abort();
      throw 'use-webview';
    });
    const extractor = await createReceiptExtractor('rule', 'native');
    const error = await extractor
      .extract(IMAGE, { signal: controller.signal })
      .catch((e: unknown) => e);
    expect(isAbortError(error)).toBe(true);
    expect(calls.recognize).not.toHaveBeenCalled();
    expect(calls.take).not.toHaveBeenCalled();
  });

  test('gemini への use-webview は開始の失敗', async () => {
    const calls = installBridge(useWebview);
    await expect(
      runReceiptInRunner(
        { engine: 'gemini', model: 'g', apiKey: 'k' },
        'generativelanguage.googleapis.com',
        IMAGE,
      ),
    ).rejects.toThrow(m.runner_start_failed());
    expect(calls.take).not.toHaveBeenCalled();
  });
});

describe('端末内のエンジンの結果の検査', () => {
  const todayOutputs: [string, ReceiptExtracted][] = [
    ['tesseract', extractFromOcrText('2026年05月14日\n合計 ¥248\n登録番号 T1234567890123')],
    ['tesseract（合計も日付も空）', extractFromOcrText('読めない')],
    ['native', extractFromOcrLayout(LAYOUT)],
    ['native（空のテキスト）', extractFromOcrLayout({ lines: [], text: '' })],
  ];
  test.each(todayOutputs)('%s：従来の出力をそのまま通す', (_, value) => {
    expect(localReceiptFromRunner(JSON.parse(JSON.stringify(value)))).toEqual(value);
  });

  test('apple-ai：従来の出力（空の合計・日付も）をそのまま通す', async () => {
    for (const apple of [
      APPLE,
      { ...APPLE, total: '', date: '', invoiceNumber: '1234567890123' },
    ]) {
      const value = await extractReceiptWithAppleAi(IMAGE, {
        appleAiAvailability: async () => 0,
        appleAiExtract: async () => JSON.stringify(apple),
      });
      expect(localReceiptFromRunner(JSON.parse(JSON.stringify(value)))).toEqual(value);
    }
  });

  const base = { date: '', vendorName: '', totalAmount: '', items: [] };
  test.each([
    ['taxRate: -1', { ...base, taxRate: -1 }],
    ['taxRate: 0.1', { ...base, taxRate: 0.1 }],
    ['taxAmount', { ...base, taxAmount: '18' }],
    ['ほかの項目', { ...base, extra: 'x' }],
    [
      '__proto__',
      JSON.parse('{"date":"","vendorName":"","totalAmount":"","items":[],"__proto__":{}}'),
    ],
    ['数値の totalAmount', { ...base, totalAmount: 248 }],
    ['品目の余分な項目', { ...base, items: [{ description: 'a', amount: '1', x: 1 }] }],
    ['数値の品目の金額', { ...base, items: [{ description: 'a', amount: 1 }] }],
    ['notes が数値', { ...base, notes: 1 }],
  ])('%s は invalid-result', async (_, value) => {
    expect(localReceiptFromRunner(value)).toBeNull();
    installBridge(async () => {}, { outcome: 'done', result: value });
    const extractor = await createReceiptExtractor('rule', 'native');
    await expect(extractor.extract(IMAGE)).rejects.toThrow(m.runner_invalid_result());
  });

  test('受け取った値は使わず、新しいオブジェクトに組み直す', () => {
    const value = { ...base, items: [{ description: 'a', amount: '1' }] };
    const out = localReceiptFromRunner(value);
    expect(out).toEqual(value);
    expect(out).not.toBe(value);
    expect(out?.items[0]).not.toBe(value.items[0]);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  test('失敗は決まった文言のまま、通信の失敗は端末内の失敗の文言', async () => {
    installBridge(async () => {}, {
      outcome: 'failed',
      error: { code: 'error', message: m.runner_local_engine_failed() },
    });
    let extractor = await createReceiptExtractor('rule', 'tesseract');
    await expect(extractor.extract(IMAGE)).rejects.toThrow(m.runner_local_engine_failed());
    installBridge(async () => {}, { outcome: 'failed', error: { code: 'connection' } });
    extractor = await createReceiptExtractor('rule', 'native');
    await expect(extractor.extract(IMAGE)).rejects.toThrow(m.runner_local_engine_failed());
  });
});
