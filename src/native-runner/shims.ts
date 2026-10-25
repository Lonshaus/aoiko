// JSContext（JavaScriptCore を直接使う環境）に無いもののうち、解析の経路が使うものだけを補う。
// 通信とタイマーはネイティブ側が aoikoHost として渡す関数へ回す。それ以外の入口は作らない。
import type { OcrLayout } from '../domain/receipt-text-extract';
import type { NativeBridge } from '../lib/native-bridge';

export interface HostReply {
  meta: string;
  body: string;
}

export interface HostImage {
  width: number;
  height: number;
  rgba: ArrayBuffer;
}

export type HostAssetName = 'tesseract-core' | 'tesseract-core-fallback' | 'jpn-traineddata';
// 端末内のエンジンの関数は、画像を引数に取らない（ネイティブ側が開始のときに受け取った画像を使う）。
export interface AoikoHost {
  fetch(request: string, body: string | undefined): Promise<HostReply>;
  setTimeout(callback: () => void, delay?: number): number;
  clearTimeout(id: number): void;
  progress(done: number, total: number): void;
  appleAiAvailability(): Promise<number>;
  appleAiExtract(): Promise<string>;
  appleAiRun(task: 1 | 2, data: string): Promise<string>;
  recognizeText(): Promise<OcrLayout>;
  decodeImage(): Promise<HostImage>;
  assetBuffer(name: HostAssetName): ArrayBuffer;
}
// apple-ai-engine.ts と AppleAiAdapter が受け取る橋渡しの形で、aoikoHost の関数を渡す。
export function hostAppleAiBridge(): Pick<
  NativeBridge,
  'appleAiAvailability' | 'appleAiExtract' | 'appleAiRun'
> {
  return {
    appleAiAvailability: () => host().appleAiAvailability(),
    appleAiExtract: () => host().appleAiExtract(),
    appleAiRun: (task, data) => {
      if (task !== 1 && task !== 2) {
        return Promise.reject(2);
      }
      return host().appleAiRun(task, data);
    },
  };
}

type Listener = (event: { type: string }) => void;

export function host(): AoikoHost {
  return (globalThis as unknown as { aoikoHost: AoikoHost }).aoikoHost;
}
// 通信の失敗の理由はネイティブ側から受け取らない。固定の文言の TypeError（標準の fetch と同じ型）にする。
export class HostFetchError extends TypeError {
  constructor() {
    super('network request failed');
    this.name = 'TypeError';
  }
}

export function isHostFetchError(e: unknown): boolean {
  return e instanceof HostFetchError;
}

export class ShimDOMException extends Error {
  constructor(message: string = '', name: string = 'Error') {
    super(message);
    this.name = name;
  }
}

function abortError(): Error {
  const Ctor = (globalThis as unknown as { DOMException: typeof ShimDOMException }).DOMException;
  return new Ctor('The operation was aborted.', 'AbortError');
}

export class ShimAbortSignal {
  aborted = false;
  reason: unknown = undefined;
  onabort: Listener | null = null;
  private readonly listeners = new Set<Listener>();

  addEventListener(type: string, listener: Listener, options?: { once?: boolean }): void {
    if (type !== 'abort') {
      return;
    }
    if (options?.once) {
      const once: Listener = (event) => {
        this.listeners.delete(once);
        listener(event);
      };
      this.listeners.add(once);
      return;
    }
    this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    if (type === 'abort') {
      this.listeners.delete(listener);
    }
  }

  throwIfAborted(): void {
    if (this.aborted) {
      throw this.reason;
    }
  }

  dispatch(reason: unknown): void {
    if (this.aborted) {
      return;
    }
    this.aborted = true;
    this.reason = reason;
    const event = { type: 'abort' };
    for (const listener of [...this.listeners]) {
      listener(event);
    }
    this.onabort?.(event);
  }
}

export class ShimAbortController {
  readonly signal = new ShimAbortSignal();

  abort(reason?: unknown): void {
    this.signal.dispatch(reason === undefined ? abortError() : reason);
  }
}

export class ShimHeaders {
  private readonly map = new Map<string, string>();

  constructor(pairs: unknown) {
    if (!Array.isArray(pairs)) {
      return;
    }
    for (const pair of pairs) {
      if (Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string') {
        this.map.set(pair[0].toLowerCase(), pair[1]);
      }
    }
  }

  get(name: string): string | null {
    return this.map.get(name.toLowerCase()) ?? null;
  }

  has(name: string): boolean {
    return this.map.has(name.toLowerCase());
  }
}

export class ShimResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly headers: ShimHeaders;
  private readonly body: string;

  constructor(head: { status?: unknown; statusText?: unknown; headers?: unknown }, body: string) {
    this.status = typeof head.status === 'number' ? head.status : 0;
    this.statusText = typeof head.statusText === 'string' ? head.statusText : '';
    this.headers = new ShimHeaders(head.headers);
    this.ok = this.status >= 200 && this.status < 300;
    this.body = body;
  }

  text(): Promise<string> {
    return Promise.resolve(this.body);
  }

  // 失敗の文言は web view（WebKit）の Response.json() に合わせる。JSON.parse の文言は画面に出る文言と違う。
  json(): Promise<unknown> {
    return Promise.resolve().then(() => {
      try {
        return JSON.parse(this.body) as unknown;
      } catch {
        throw new ShimDOMException('The string did not match the expected pattern.', 'SyntaxError');
      }
    });
  }
}
// http(s) の URL の host / origin を読むだけの最小限。それ以外の形は TypeError（標準の URL と同じ）。
const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

export class ShimURL {
  readonly protocol: string;
  readonly hostname: string;
  readonly port: string;
  readonly host: string;
  readonly origin: string;
  readonly href: string;

  constructor(input: unknown) {
    const raw = String(input).trim();
    const matched = /^(https?):\/\/([^/?#]*)/i.exec(raw);
    const authority = matched?.[2] ?? '';
    if (matched === null || authority === '' || authority.includes('@')) {
      throw new TypeError('Invalid URL');
    }
    this.protocol = `${(matched[1] ?? '').toLowerCase()}:`;
    const portMatch = /^(.*?)(?::(\d*))?$/.exec(authority);
    this.hostname = (portMatch?.[1] ?? authority).toLowerCase();
    const port = portMatch?.[2] ?? '';
    this.port = port === DEFAULT_PORTS[this.protocol] ? '' : port;
    this.host = this.port === '' ? this.hostname : `${this.hostname}:${this.port}`;
    this.origin = `${this.protocol}//${this.host}`;
    this.href = raw;
  }

  toString(): string {
    return this.href;
  }
}

function headerPairs(headers: unknown): [string, string][] {
  if (Array.isArray(headers)) {
    return headers.filter(
      (pair): pair is [string, string] =>
        Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string',
    );
  }
  if (typeof headers === 'object' && headers !== null) {
    return Object.entries(headers).filter((entry): entry is [string, string] => {
      return typeof entry[1] === 'string';
    });
  }
  return [];
}

type ShimInit = {
  method?: string;
  headers?: unknown;
  body?: unknown;
  signal?: ShimAbortSignal | AbortSignal;
};
// 中止されたら応答を待つのをやめる。あとから戻る応答は捨てる（標準の fetch と同じ振る舞い）。
function raceAbort<T>(signal: ShimInit['signal'], promise: Promise<T>): Promise<T> {
  if (signal === undefined) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export async function shimFetch(input: unknown, init?: ShimInit): Promise<ShimResponse> {
  const signal = init?.signal;
  if (signal?.aborted) {
    throw abortError();
  }
  const request = JSON.stringify({
    url: String(input),
    method: (init?.method ?? 'GET').toUpperCase(),
    headers: headerPairs(init?.headers),
  });
  const body = typeof init?.body === 'string' ? init.body : undefined;
  const sent = host()
    .fetch(request, body)
    .catch(() => {
      throw new HostFetchError();
    });
  const reply = await raceAbort(signal, sent);
  const head = JSON.parse(reply.meta) as {
    status?: unknown;
    statusText?: unknown;
    headers?: unknown;
  };
  return new ShimResponse(head, reply.body);
}

export function installShims(): void {
  const scope = globalThis as unknown as Record<string, unknown>;
  const fill = (name: string, value: unknown) => {
    if (typeof scope[name] === 'undefined') {
      scope[name] = value;
    }
  };
  fill('DOMException', ShimDOMException);
  fill('AbortController', ShimAbortController);
  fill('AbortSignal', ShimAbortSignal);
  fill('URL', ShimURL);
  // 通信とタイマーは、あっても必ずネイティブ側の関数を通す。
  scope.fetch = shimFetch;
  scope.setTimeout = (callback: () => void, delay?: number) => host().setTimeout(callback, delay);
  scope.clearTimeout = (id: number) => host().clearTimeout(id);
}
