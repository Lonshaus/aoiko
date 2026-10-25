// 解析を web view の外（アプリのプロセス）で走らせる側の窓口。LLM のほか、端末内のエンジン
// （tesseract・OS の文字認識・OS の AI）もここを通る。
// 使うかどうかは抽出器を作るときに 1 度だけ決め、それ以外の環境・エンジンは従来の経路のまま。
// 送る設定は抽出器を作ったときの値（送信前確認に出した宛先と同じ 1 回の読み出し）に限り、
// 戻ってきた結果は種類ごとに形を確かめてから使う。
import { LlmError, hostOf, type LlmCallOptions, type LlmImageInput } from '../domain/llm';
import type { ReceiptExtracted, ReceiptItem } from '../domain/ocr';
import type { OrderExtracted, OrderItem } from '../domain/order-extract';
import type { Account } from '../db/types';
import { m } from '../paraglide/messages';
import { getLocale } from '../paraglide/runtime';
import { D } from './decimal';
import { newId } from './id';
import type { LlmConfig } from './llm-adapter';
import type { ReceiptExtractor } from './receipt-extractor';
import { nativeBridge, type NativeBridge } from './native-bridge';
import { isOffline } from './network-status';
import { getSetting } from './settings';

export type RunnerConfig = Extract<
  LlmConfig,
  { engine: 'gemini' | 'openai-compatible' | 'apple-ai' }
>;
// 領収書を端末内で読むエンジン。
export type LocalReceiptEngine = 'tesseract' | 'native' | 'apple-ai';

type RunnerEngine = RunnerConfig['engine'] | LocalReceiptEngine;

type RunnerBridge = Required<Pick<NativeBridge, 'runAnalysis' | 'takeAnalysis' | 'cancelAnalysis'>>;

export type RunnerSuggestion = {
  ref: string;
  accountCode: string | null;
  confidence: 'high' | 'low' | 'none';
  reason?: string;
  failed?: true;
};

export type RunnerClassifyGroup = {
  knownSide: 'debit' | 'credit';
  inputs: { ref: string; description: string; amount: string }[];
  knownAccountCode: string;
  candidateAccounts: Account[];
};

export type RunnerClassifyPartial = { group: number; suggestions: RunnerSuggestion[] };

export type RunnerClassifyOutcome =
  | { kind: 'done'; groups: RunnerSuggestion[][] }
  | { kind: 'failed'; error: Error; partial: RunnerClassifyPartial[] }
  | { kind: 'cancelled'; partial: RunnerClassifyPartial[] };

const GEMINI_HOST = 'generativelanguage.googleapis.com';

function runnerBridge(): RunnerBridge | null {
  const bridge = nativeBridge();
  if (
    bridge === null ||
    typeof bridge.runAnalysis !== 'function' ||
    typeof bridge.takeAnalysis !== 'function' ||
    typeof bridge.cancelAnalysis !== 'function'
  ) {
    return null;
  }
  return bridge as RunnerBridge;
}
// 使えるのはネイティブ版で、橋渡しに runAnalysis があるとき。
export function runnerAvailable(): boolean {
  return __NATIVE__ && runnerBridge() !== null;
}
// 注文取込と分類で使うのは、エンジンが LLM か OS の AI のとき。
export function runnerConfig(config: LlmConfig): RunnerConfig | null {
  if (!runnerAvailable()) {
    return null;
  }
  return config.engine === 'gemini' ||
    config.engine === 'openai-compatible' ||
    config.engine === 'apple-ai'
    ? config
    : null;
}
// アダプターが付ける宛先と同じ求め方（末尾の / を落としてから host を取る）。端末内のエンジンは空。
function destinationOf(config: RunnerConfig | { engine: LocalReceiptEngine }): string {
  if (config.engine === 'gemini') {
    return GEMINI_HOST;
  }
  if (config.engine === 'openai-compatible') {
    return hostOf(config.baseUrl.replace(/\/+$/, ''));
  }
  return '';
}

function abortError(): Error {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function nativeLocale(): 'ja' | 'en' | 'zh-TW' {
  const locale = getLocale();
  return locale === 'en' || locale === 'zh-TW' ? locale : 'ja';
}
type LlmRunnerConfig = Extract<RunnerConfig, { engine: 'gemini' | 'openai-compatible' }>;
// 従来の経路で通信に失敗したときの文言から、環境の理由（「：」以降）を除いたもの。
function connectionMessage(config: LlmRunnerConfig): string {
  if (isOffline()) {
    return m.common_offline_error();
  }
  if (config.engine === 'gemini') {
    return m.error_gemini_connection_failed();
  }
  return `${destinationOf(config)} への接続に失敗しました（ローカル LLM サーバ起動・CORS 設定を確認）`;
}
// 従来の経路で許可外の URL を指定したときと同じ文言（src-tauri/src/lib.rs の文言を後ろに付ける）。
function disallowedUrlMessage(config: LlmRunnerConfig): string {
  if (isOffline() || config.engine !== 'openai-compatible') {
    return connectionMessage(config);
  }
  let target = '';
  try {
    const url = new URL(config.baseUrl);
    target = `${url.protocol.replace(/:$/, '')}://${url.hostname}`;
  } catch {
    return m.runner_start_failed();
  }
  return `${connectionMessage(config)}：許可されていない URL です: ${target}`;
}

function startError(e: unknown, config: JobConfig): Error {
  if (e === 'disallowed-url' && config.engine === 'openai-compatible') {
    return new LlmError(disallowedUrlMessage(config));
  }
  return new Error(m.runner_start_failed());
}
// ジョブに載せる設定。端末内のエンジンは adapter を持たない。
type JobConfig = RunnerConfig | { engine: LocalReceiptEngine };

function adapterOf(config: JobConfig) {
  if (config.engine === 'gemini') {
    return { adapter: { model: config.model, apiKey: config.apiKey } };
  }
  if (config.engine === 'openai-compatible') {
    return { adapter: { model: config.model, apiKey: config.apiKey, baseUrl: config.baseUrl } };
  }
  return {};
}

type TakeFailure =
  | { code: 'llm'; message: string; status?: number }
  | { code: 'connection' }
  | { code: 'error'; message: string }
  | { code: 'expired' }
  | { code: 'invalid-result' };

type TakeResult =
  | { outcome: 'done'; result: Record<string, unknown> }
  | { outcome: 'failed'; error: TakeFailure; partial?: unknown }
  | { outcome: 'cancelled'; partial?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parseFailure(value: unknown): TakeFailure | null {
  if (!isRecord(value)) {
    return null;
  }
  const { code, message, status } = value;
  if (
    code === 'llm' &&
    typeof message === 'string' &&
    onlyKeys(value, ['code', 'message', 'status'])
  ) {
    if (status === undefined) {
      return { code, message };
    }
    return typeof status === 'number' && Number.isInteger(status)
      ? { code, message, status }
      : null;
  }
  if (code === 'error' && typeof message === 'string' && onlyKeys(value, ['code', 'message'])) {
    return { code, message };
  }
  if (
    (code === 'connection' || code === 'expired' || code === 'invalid-result') &&
    onlyKeys(value, ['code'])
  ) {
    return { code };
  }
  return null;
}

function parseTake(raw: unknown): TakeResult | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (raw.outcome === 'done' && isRecord(raw.result) && onlyKeys(raw, ['outcome', 'result'])) {
    return { outcome: 'done', result: raw.result };
  }
  if (raw.outcome === 'failed' && onlyKeys(raw, ['outcome', 'error', 'partial'])) {
    const error = parseFailure(raw.error);
    return error === null ? null : { outcome: 'failed', error, partial: raw.partial };
  }
  if (raw.outcome === 'cancelled' && onlyKeys(raw, ['outcome', 'partial'])) {
    return { outcome: 'cancelled', partial: raw.partial };
  }
  return null;
}

function invalidResult(): Error {
  return new Error(m.runner_invalid_result());
}

function failureError(error: TakeFailure, config: JobConfig): Error {
  switch (error.code) {
    case 'llm':
      return new LlmError(error.message, undefined, error.status);
    case 'connection':
      // 端末内のエンジンのジョブは通信を断られる。届くとすれば配線の誤り。
      if (config.engine !== 'gemini' && config.engine !== 'openai-compatible') {
        return new Error(m.runner_local_engine_failed());
      }
      return new LlmError(connectionMessage(config));
    case 'error':
      return new Error(error.message);
    case 'expired':
      return new Error(m.runner_expired());
    case 'invalid-result':
      return invalidResult();
  }
}
// 中止されたら待つのをやめる（receipt / order）。分類は取消し前に終わったグループを受け取るため待ち続ける。
function raceAbort<T>(signal: AbortSignal | undefined, promise: Promise<T>): Promise<T> {
  if (signal === undefined) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

// 'use-webview' は、端末内のエンジンで読む領収書を ネイティブ側が断ったときだけ返す（それ以外は開始の失敗）。
async function runJob(
  kind: 'receipt' | 'order' | 'classify',
  config: JobConfig,
  shownHost: string,
  input: unknown,
  signal: AbortSignal | undefined,
  waitAfterAbort: boolean,
): Promise<TakeResult | null | 'use-webview'> {
  const bridge = runnerBridge();
  // 確認ダイアログに出した宛先と食い違う設定では送らない。
  if (bridge === null || destinationOf(config) !== shownHost) {
    throw new Error(m.runner_start_failed());
  }
  if (signal?.aborted) {
    throw abortError();
  }
  const job = newId();
  const engine: RunnerEngine = config.engine;
  const spec = {
    job,
    kind,
    engine,
    locale: nativeLocale(),
    notify: (await getSetting('analysisNotifyEnabled')) === true,
    ...adapterOf(config),
    input,
  };
  try {
    await bridge.runAnalysis(spec);
  } catch (e) {
    if (e === 'use-webview' && kind === 'receipt' && isLocalReceiptEngine(engine)) {
      return 'use-webview';
    }
    throw startError(e, config);
  }
  let cancelled = false;
  const onAbort = () => {
    if (!cancelled) {
      cancelled = true;
      void bridge.cancelAnalysis(job).catch(() => {});
    }
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) {
    onAbort();
  }
  try {
    const taken = bridge.takeAnalysis(job);
    const raw = waitAfterAbort ? await taken : await raceAbort(signal, taken);
    return parseTake(raw);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

function isMoney(value: unknown, allowNegative: boolean): value is string {
  const pattern = allowNegative ? /^-?\d+$/ : /^\d+$/;
  return typeof value === 'string' && pattern.test(value) && D(value).isFinite();
}

function parseItems(value: unknown, allowNegative: boolean): ReceiptItem[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items: ReceiptItem[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !onlyKeys(item, ['description', 'amount']) ||
      typeof item.description !== 'string' ||
      item.description === '' ||
      !isMoney(item.amount, allowNegative)
    ) {
      return null;
    }
    items.push({ description: item.description, amount: item.amount });
  }
  return items;
}

const RECEIPT_KEYS = [
  'date',
  'vendorName',
  'totalAmount',
  'items',
  'taxAmount',
  'taxRate',
  'invoiceNumber',
  'notes',
] as const;
// domain/ocr.ts の parseOcrResponse が返し得る形だけを通し、新しいオブジェクトへ組み直す。
export function receiptFromRunner(value: unknown): ReceiptExtracted | null {
  if (!isRecord(value) || !onlyKeys(value, RECEIPT_KEYS)) {
    return null;
  }
  const { date, vendorName, totalAmount, taxAmount, taxRate, invoiceNumber, notes } = value;
  const items = parseItems(value.items, true);
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    typeof vendorName !== 'string' ||
    !isMoney(totalAmount, true) ||
    items === null
  ) {
    return null;
  }
  const result: ReceiptExtracted = { date, vendorName, totalAmount, items };
  if (taxAmount !== undefined) {
    if (!isMoney(taxAmount, true)) {
      return null;
    }
    result.taxAmount = taxAmount;
  }
  if (taxRate !== undefined) {
    if (typeof taxRate !== 'number' || !(taxRate >= 0 && taxRate <= 1)) {
      return null;
    }
    result.taxRate = taxRate;
  }
  if (invoiceNumber !== undefined) {
    if (typeof invoiceNumber !== 'string' || !/^T\d{13}$/.test(invoiceNumber)) {
      return null;
    }
    result.invoiceNumber = invoiceNumber;
  }
  if (notes !== undefined) {
    if (typeof notes !== 'string' || notes === '') {
      return null;
    }
    result.notes = notes;
  }
  return result;
}
// domain/order-extract.ts の parseOrderResponse が返し得る形だけを通す。
export function orderFromRunner(value: unknown): OrderExtracted | null {
  if (
    !isRecord(value) ||
    !onlyKeys(value, ['date', 'vendor', 'orderNumber', 'items', 'totalAmount'])
  ) {
    return null;
  }
  const { date, vendor, orderNumber, totalAmount } = value;
  const items: OrderItem[] | null = parseItems(value.items, true);
  if (
    typeof date !== 'string' ||
    typeof vendor !== 'string' ||
    !isMoney(totalAmount, false) ||
    items === null ||
    items.length === 0
  ) {
    return null;
  }
  const result: OrderExtracted = { date, vendor, items, totalAmount };
  if (orderNumber !== undefined) {
    if (typeof orderNumber !== 'string' || orderNumber === '') {
      return null;
    }
    result.orderNumber = orderNumber;
  }
  return result;
}
// 送った行の ref と、そのグループの候補の科目コードだけを受け付ける。
function suggestionsFromRunner(
  value: unknown,
  group: RunnerClassifyGroup,
): RunnerSuggestion[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const refs = new Set(group.inputs.map((input) => input.ref));
  const codes = new Set(group.candidateAccounts.map((account) => account.code));
  const seen = new Set<string>();
  const suggestions: RunnerSuggestion[] = [];
  for (const raw of value) {
    if (
      !isRecord(raw) ||
      !onlyKeys(raw, ['ref', 'accountCode', 'confidence', 'reason', 'failed'])
    ) {
      return null;
    }
    const { ref, accountCode, confidence, reason, failed } = raw;
    if (typeof ref !== 'string' || !refs.has(ref) || seen.has(ref)) {
      return null;
    }
    seen.add(ref);
    if (accountCode !== null && (typeof accountCode !== 'string' || !codes.has(accountCode))) {
      return null;
    }
    if (confidence !== 'high' && confidence !== 'low' && confidence !== 'none') {
      return null;
    }
    if (confidence !== 'none' && accountCode === null) {
      return null;
    }
    const suggestion: RunnerSuggestion = { ref, accountCode, confidence };
    if (reason !== undefined) {
      if (typeof reason !== 'string' || reason === '') {
        return null;
      }
      suggestion.reason = reason;
    }
    if (failed !== undefined) {
      if (failed !== true) {
        return null;
      }
      suggestion.failed = true;
    }
    suggestions.push(suggestion);
  }
  return suggestions;
}

function partialFromRunner(
  value: unknown,
  groups: RunnerClassifyGroup[],
): RunnerClassifyPartial[] | null {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const partial: RunnerClassifyPartial[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || !onlyKeys(raw, ['group', 'suggestions'])) {
      return null;
    }
    const index = raw.group;
    const group = typeof index === 'number' ? groups[index] : undefined;
    const suggestions = group === undefined ? null : suggestionsFromRunner(raw.suggestions, group);
    if (typeof index !== 'number' || suggestions === null) {
      return null;
    }
    partial.push({ group: index, suggestions });
  }
  return partial.sort((a, b) => a.group - b.group);
}

function isLocalReceiptEngine(engine: string): engine is LocalReceiptEngine {
  return engine === 'tesseract' || engine === 'native' || engine === 'apple-ai';
}

const LOCAL_RECEIPT_KEYS = [
  'date',
  'vendorName',
  'totalAmount',
  'items',
  'notes',
  'invoiceNumber',
] as const;
// 端末内のエンジンが返し得る項目だけを通す。値は文字列のまま（空や正規化前もあり得る）で、
// 確定の前の検査は画面側で行う。受け取った値は使わず、項目の一覧から新しいオブジェクトを組み直す。
export function localReceiptFromRunner(value: unknown): ReceiptExtracted | null {
  if (!isRecord(value) || !onlyKeys(value, LOCAL_RECEIPT_KEYS)) {
    return null;
  }
  const { date, vendorName, totalAmount, items, notes, invoiceNumber } = value;
  if (
    typeof date !== 'string' ||
    typeof vendorName !== 'string' ||
    typeof totalAmount !== 'string' ||
    !Array.isArray(items)
  ) {
    return null;
  }
  const rebuilt: ReceiptItem[] = [];
  for (const item of items) {
    if (
      !isRecord(item) ||
      Object.keys(item).length !== 2 ||
      typeof item.description !== 'string' ||
      typeof item.amount !== 'string'
    ) {
      return null;
    }
    rebuilt.push({ description: item.description, amount: item.amount });
  }
  const result: ReceiptExtracted = { date, vendorName, totalAmount, items: rebuilt };
  if (Object.hasOwn(value, 'notes')) {
    if (typeof notes !== 'string') {
      return null;
    }
    result.notes = notes;
  }
  if (Object.hasOwn(value, 'invoiceNumber')) {
    if (typeof invoiceNumber !== 'string') {
      return null;
    }
    result.invoiceNumber = invoiceNumber;
  }
  return result;
}
// 端末内のエンジンで読む領収書。ネイティブ側が画像を扱わないと答えたら（大きすぎる・Wasm が使えない）、
// 準備のときに作った同じエンジンの抽出器（web view の経路）で読む。設定は読み直さない。
export async function runLocalReceiptInRunner(
  prepared: ReceiptExtractor,
  engine: LocalReceiptEngine,
  image: LlmImageInput,
  options?: LlmCallOptions,
): Promise<ReceiptExtracted> {
  const config = { engine };
  const taken = await runJob('receipt', config, '', { image }, options?.signal, false);
  if (taken === 'use-webview') {
    if (options?.signal?.aborted) {
      throw abortError();
    }
    return prepared.extract(image, options);
  }
  if (taken?.outcome === 'failed') {
    throw failureError(taken.error, config);
  }
  if (taken?.outcome === 'cancelled') {
    throw abortError();
  }
  const result = taken === null ? null : localReceiptFromRunner(taken.result);
  if (result === null) {
    throw invalidResult();
  }
  return result;
}

export async function runReceiptInRunner(
  config: RunnerConfig,
  shownHost: string,
  image: LlmImageInput,
  options?: LlmCallOptions,
): Promise<ReceiptExtracted> {
  const taken = await runJob('receipt', config, shownHost, { image }, options?.signal, false);
  if (taken === 'use-webview') {
    throw new Error(m.runner_start_failed());
  }
  if (taken?.outcome === 'failed') {
    throw failureError(taken.error, config);
  }
  if (taken?.outcome === 'cancelled') {
    throw abortError();
  }
  const result = taken === null ? null : receiptFromRunner(taken.result);
  if (result === null) {
    throw invalidResult();
  }
  return result;
}

export async function runOrderInRunner(
  config: RunnerConfig,
  shownHost: string,
  text: string,
  options?: LlmCallOptions,
): Promise<OrderExtracted> {
  const taken = await runJob('order', config, shownHost, { text }, options?.signal, false);
  if (taken === 'use-webview') {
    throw new Error(m.runner_start_failed());
  }
  if (taken?.outcome === 'failed') {
    throw failureError(taken.error, config);
  }
  if (taken?.outcome === 'cancelled') {
    throw abortError();
  }
  const result = taken === null ? null : orderFromRunner(taken.result);
  if (result === null) {
    throw invalidResult();
  }
  return result;
}
// すべてのグループを 1 つのジョブで送る。科目はプロンプトが使う項目だけを写して送る。
export async function runClassifyInRunner(
  config: RunnerConfig,
  shownHost: string,
  groups: RunnerClassifyGroup[],
  signal: AbortSignal,
): Promise<RunnerClassifyOutcome> {
  const input = {
    groups: groups.map((group) => ({
      knownSide: group.knownSide,
      inputs: group.inputs.map((row) => ({
        ref: row.ref,
        description: row.description,
        amount: row.amount,
      })),
      options: {
        knownAccountCode: group.knownAccountCode,
        knownSide: group.knownSide,
        candidateAccounts: group.candidateAccounts.map((account) => ({
          code: account.code,
          name: account.name,
          category: account.category,
        })),
      },
    })),
  };
  const taken = await runJob('classify', config, shownHost, input, signal, true);
  if (taken === 'use-webview') {
    return { kind: 'failed', error: new Error(m.runner_start_failed()), partial: [] };
  }
  if (taken === null) {
    return { kind: 'failed', error: invalidResult(), partial: [] };
  }
  if (taken.outcome === 'done') {
    const list = taken.result.suggestions;
    const answered =
      Array.isArray(list) &&
      list.length === groups.length &&
      onlyKeys(taken.result, ['suggestions'])
        ? groups.map((group, index) => suggestionsFromRunner(list[index], group))
        : null;
    if (answered === null || answered.some((group) => group === null)) {
      return { kind: 'failed', error: invalidResult(), partial: [] };
    }
    return { kind: 'done', groups: answered as RunnerSuggestion[][] };
  }
  const partial = partialFromRunner(taken.partial, groups);
  if (partial === null) {
    return { kind: 'failed', error: invalidResult(), partial: [] };
  }
  if (taken.outcome === 'failed') {
    return { kind: 'failed', error: failureError(taken.error, config), partial };
  }
  return { kind: 'cancelled', partial };
}
