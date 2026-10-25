// web view の外（アプリのプロセスの JSContext）から解析を走らせる入口。
// esbuild で 1 本の IIFE（runner.js）に束ね、ネイティブ側が評価する。受け取るのは Rust が検査した仕様の
// JSON 文字列だけで、返すのも JSON 文字列。解析そのものは web view の経路と同じ domain の関数を使う。
// 端末内のエンジン（tesseract・OS の文字認識・OS の AI）は、ネイティブ側が aoikoHost に置く関数を通して動かす。
import { createOCREngine, supportsFastBuild } from 'tesseract-wasm';
import { m } from '../paraglide/messages';
import { overwriteGetLocale } from '../paraglide/runtime';
import {
  GeminiAdapter,
  LlmError,
  OpenAICompatibleAdapter,
  isAbortError,
  type LlmAdapter,
  type LlmImageInput,
} from '../domain/llm';
import { extractReceipt, type ReceiptExtracted } from '../domain/ocr';
import { buildOrderPrompt, parseOrderResponse } from '../domain/order-extract';
import { classifyWithLlm, type ClassifyInput } from '../domain/llm-classify';
import {
  extractFromOcrLayout,
  extractFromOcrText,
  type OcrLayout,
} from '../domain/receipt-text-extract';
import type { Account } from '../db/types';
import { AppleAiAdapter } from '../lib/apple-ai-adapter';
import { extractReceiptWithAppleAi } from '../lib/ocr/apple-ai-engine';
import { NATIVE_NO_TEXT_MESSAGE } from '../lib/ocr/native-engine';
import { host, hostAppleAiBridge, installShims, isHostFetchError } from './shims';

installShims();

type Side = 'debit' | 'credit';

export type RunnerClassifyGroup = {
  knownSide: Side;
  inputs: ClassifyInput[];
  options: {
    knownAccountCode: string;
    knownSide: Side;
    candidateAccounts: Pick<Account, 'code' | 'name' | 'category'>[];
  };
};

export type RunnerEngine = 'gemini' | 'openai-compatible' | 'tesseract' | 'native' | 'apple-ai';
// adapter は LLM のときだけ。端末内のエンジンには無い。
export type RunnerSpec = {
  job: string;
  kind: 'receipt' | 'order' | 'classify';
  engine: RunnerEngine;
  locale: 'ja' | 'en' | 'zh-TW';
  notify: boolean;
  adapter?: { model: string; apiKey: string; baseUrl?: string };
  input: { image: LlmImageInput } | { text: string } | { groups: RunnerClassifyGroup[] };
};

type GroupPartial = { group: number; suggestions: unknown[] };

type Failure =
  | { code: 'llm'; message: string; status?: number }
  | { code: 'connection' }
  | { code: 'error'; message: string };

function adapterOf(spec: RunnerSpec): LlmAdapter {
  const adapter = spec.adapter ?? { model: '', apiKey: '' };
  if (spec.engine === 'apple-ai') {
    return new AppleAiAdapter(hostAppleAiBridge());
  }
  if (spec.engine === 'gemini') {
    return new GeminiAdapter(adapter.apiKey, adapter.model);
  }
  return new OpenAICompatibleAdapter(adapter.baseUrl ?? '', adapter.model, adapter.apiKey);
}
// order-extractor.ts と同じ組み立て（両経路の送信内容が同じことはテストで見ている）。
async function extractOrder(adapter: LlmAdapter, text: string, signal: AbortSignal) {
  const raw = adapter.runDataTask
    ? await adapter.runDataTask('order', { text }, { signal })
    : await adapter.generateJson(
        `${buildOrderPrompt()}\n\n---\n以下が貼り付けテキスト：\n\n${text}`,
        undefined,
        { signal },
      );
  return parseOrderResponse(raw);
}
function abortedError(): Error {
  return new DOMException('The operation was aborted.', 'AbortError');
}
// tesseract-engine.ts と同じ手順（画像 → tesseract → 素のテキストからの抽出）。画像の復号はネイティブ側が行い、
// Wasm と日本語モデルは名前の決まったアセットとして受け取る。ビルドの選び方は worker と同じ。
async function tesseractReceipt(signal: AbortSignal): Promise<ReceiptExtracted> {
  let text: string;
  try {
    const image = await host().decodeImage();
    const fast = supportsFastBuild();
    const wasmBinary = host().assetBuffer(fast ? 'tesseract-core' : 'tesseract-core-fallback');
    const engine = await createOCREngine({ wasmBinary });
    try {
      engine.loadModel(host().assetBuffer('jpn-traineddata'));
      engine.loadImage({
        width: image.width,
        height: image.height,
        data: new Uint8ClampedArray(image.rgba),
      } as ImageData);
      if (signal.aborted) {
        throw abortedError();
      }
      text = engine.getText();
    } finally {
      engine.destroy();
    }
  } catch (e) {
    if (signal.aborted || isAbortError(e)) {
      throw e;
    }
    throw new Error(m.runner_local_engine_failed(), { cause: e });
  }
  return extractFromOcrText(text);
}
// native-engine.ts と同じ抽出。失敗の理由は 'no-text' と 'failed' だけが届く。
async function nativeReceipt(): Promise<ReceiptExtracted> {
  let layout: OcrLayout;
  try {
    layout = await host().recognizeText();
  } catch (reason) {
    throw new Error(
      reason === 'no-text' ? NATIVE_NO_TEXT_MESSAGE : m.runner_text_recognition_failed(),
    );
  }
  return extractFromOcrLayout(layout);
}

function localReceipt(spec: RunnerSpec, image: LlmImageInput, signal: AbortSignal) {
  switch (spec.engine) {
    case 'tesseract':
      return tesseractReceipt(signal);
    case 'native':
      return nativeReceipt();
    case 'apple-ai':
      return extractReceiptWithAppleAi(image, hostAppleAiBridge());
    default:
      return null;
  }
}

function failureOf(e: unknown): Failure {
  if (isHostFetchError(e) || (e instanceof LlmError && isHostFetchError(e.cause))) {
    return { code: 'connection' };
  }
  if (e instanceof LlmError) {
    return e.status === undefined
      ? { code: 'llm', message: e.message }
      : { code: 'llm', message: e.message, status: e.status };
  }
  return { code: 'error', message: e instanceof Error ? e.message : String(e) };
}

let current: AbortController | null = null;

async function run(specJson: string): Promise<string> {
  const controller = new AbortController();
  current = controller;
  const signal = controller.signal;
  const partial: GroupPartial[] = [];
  let kind: RunnerSpec['kind'] | null = null;
  try {
    const spec = JSON.parse(specJson) as RunnerSpec;
    kind = spec.kind;
    // メッセージはこのジョブの言語で作る。web view の設定は読めない。
    overwriteGetLocale(() => spec.locale);
    if ('image' in spec.input) {
      host().progress(0, 1);
      const local = localReceipt(spec, spec.input.image, signal);
      const result = await (local ?? extractReceipt(adapterOf(spec), spec.input.image, { signal }));
      host().progress(1, 1);
      return JSON.stringify({ outcome: 'done', result });
    }
    const adapter = adapterOf(spec);
    if ('text' in spec.input) {
      host().progress(0, 1);
      const result = await extractOrder(adapter, spec.input.text, signal);
      host().progress(1, 1);
      return JSON.stringify({ outcome: 'done', result });
    }
    const groups = spec.input.groups;
    const suggestions: unknown[][] = [];
    host().progress(0, groups.length);
    for (const [index, group] of groups.entries()) {
      const answer = await classifyWithLlm(
        adapter,
        group.inputs,
        { ...group.options, candidateAccounts: group.options.candidateAccounts as Account[] },
        { signal },
      );
      suggestions.push(answer);
      partial.push({ group: index, suggestions: answer });
      host().progress(index + 1, groups.length);
    }
    return JSON.stringify({ outcome: 'done', result: { suggestions } });
  } catch (e) {
    const kept = kind === 'classify' && partial.length > 0 ? { partial } : {};
    if (signal.aborted || isAbortError(e)) {
      return JSON.stringify({ outcome: 'cancelled', ...kept });
    }
    return JSON.stringify({ outcome: 'failed', error: failureOf(e), ...kept });
  } finally {
    if (current === controller) {
      current = null;
    }
  }
}

(globalThis as unknown as { aoikoRunner: unknown }).aoikoRunner = {
  run,
  abort(): void {
    current?.abort();
  },
};
