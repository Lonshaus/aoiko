import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  HostFetchError,
  ShimAbortController,
  ShimDOMException,
  ShimResponse,
  ShimURL,
  installShims,
  isHostFetchError,
  shimFetch,
  type AoikoHost,
  type HostReply,
} from './shims';

function fakeHost(fetch: AoikoHost['fetch'] = async () => reply(200, '{}')): AoikoHost {
  return {
    fetch: vi.fn(fetch),
    setTimeout: vi.fn(() => 7),
    clearTimeout: vi.fn(),
    progress: vi.fn(),
    appleAiAvailability: vi.fn(async () => 0),
    appleAiExtract: vi.fn(async () => '{}'),
    appleAiRun: vi.fn(async () => '{}'),
    recognizeText: vi.fn(async () => ({ lines: [], text: '' })),
    decodeImage: vi.fn(async () => ({ width: 1, height: 1, rgba: new ArrayBuffer(4) })),
    assetBuffer: vi.fn(() => new ArrayBuffer(0)),
  };
}

function reply(status: number, body: string, headers: [string, string][] = []): HostReply {
  return { meta: JSON.stringify({ status, statusText: 'S', headers }), body };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AbortController / AbortSignal', () => {
  test('中止は 1 度だけ伝わり、once の購読は 1 回で外れる', () => {
    const controller = new ShimAbortController();
    const always = vi.fn();
    const once = vi.fn();
    const removed = vi.fn();
    const onabort = vi.fn();
    controller.signal.addEventListener('abort', always);
    controller.signal.addEventListener('abort', once, { once: true });
    controller.signal.addEventListener('abort', removed);
    controller.signal.removeEventListener('abort', removed);
    controller.signal.addEventListener('other', always);
    controller.signal.onabort = onabort;
    expect(controller.signal.aborted).toBe(false);
    expect(() => controller.signal.throwIfAborted()).not.toThrow();
    controller.abort();
    controller.abort('again');
    expect(controller.signal.aborted).toBe(true);
    expect(always).toHaveBeenCalledTimes(1);
    expect(once).toHaveBeenCalledTimes(1);
    expect(onabort).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
    expect((controller.signal.reason as Error).name).toBe('AbortError');
    expect(() => controller.signal.throwIfAborted()).toThrow();
  });

  test('理由を渡したときはそれを reason にする', () => {
    const controller = new ShimAbortController();
    controller.abort('stop');
    expect(controller.signal.reason).toBe('stop');
  });

  test('DOMException の代わりは name と message を持つ Error', () => {
    const e = new ShimDOMException('m', 'AbortError');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('AbortError');
    expect(e.message).toBe('m');
    expect(new ShimDOMException().name).toBe('Error');
  });
});

describe('Response の代わり', () => {
  test('ok・status・headers・text・json', async () => {
    const response = new ShimResponse(
      {
        status: 201,
        statusText: 'Created',
        headers: [
          ['Content-Type', 'application/json'],
          [1, 2],
        ],
      },
      '{"a":1}',
    );
    expect(response.ok).toBe(true);
    expect(response.status).toBe(201);
    expect(response.statusText).toBe('Created');
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.has('CONTENT-TYPE')).toBe(true);
    expect(response.headers.get('x')).toBeNull();
    await expect(response.text()).resolves.toBe('{"a":1}');
    await expect(response.json()).resolves.toEqual({ a: 1 });
  });

  test('2xx 以外は ok ではなく、壊れた JSON は reject になる（例外を同期で投げない）', async () => {
    for (const status of [199, 300, 404, 500]) {
      expect(new ShimResponse({ status }, '').ok).toBe(false);
    }
    const broken = new ShimResponse({ status: 200 }, '<html>');
    const parsed = broken.json();
    await expect(parsed).rejects.toMatchObject({
      name: 'SyntaxError',
      message: 'The string did not match the expected pattern.',
    });
    expect(new ShimResponse({ status: 'x' }, '').status).toBe(0);
  });
});

describe('URL の代わり', () => {
  test.each([
    ['https://Example.COM/v1', 'example.com', 'https://example.com'],
    ['https://h.example:443/v1', 'h.example', 'https://h.example'],
    ['http://127.0.0.1:41741', '127.0.0.1:41741', 'http://127.0.0.1:41741'],
    ['http://localhost:80/x', 'localhost', 'http://localhost'],
    ['http://[::1]:11434/v1', '[::1]:11434', 'http://[::1]:11434'],
    ['  HTTP://host/  ', 'host', 'http://host'],
  ])('%s の host は %s', (raw, host, origin) => {
    const url = new ShimURL(raw);
    expect(url.host).toBe(host);
    expect(url.origin).toBe(origin);
    expect(url.toString()).toBe(raw.trim());
  });

  test.each([
    'ftp://example.com/',
    'http://',
    'https:///x',
    'http://user:pw@host/',
    '/v1',
    'host',
    '',
  ])('%j は TypeError', (raw) => {
    expect(() => new ShimURL(raw)).toThrow(TypeError);
  });
});

describe('fetch の代わり', () => {
  test('要求は URL・大文字のメソッド・文字列のヘッダーだけを aoikoHost へ渡す', async () => {
    const host = fakeHost(async () => reply(200, '{"ok":true}', [['x-a', 'b']]));
    vi.stubGlobal('aoikoHost', host);
    const response = await shimFetch('http://127.0.0.1:1/v1/chat/completions', {
      method: 'post',
      headers: { 'content-type': 'application/json', authorization: 'Bearer k', skip: 1 },
      body: '{"x":1}',
    });
    expect(host.fetch).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        url: 'http://127.0.0.1:1/v1/chat/completions',
        method: 'POST',
        headers: [
          ['content-type', 'application/json'],
          ['authorization', 'Bearer k'],
        ],
      }),
      '{"x":1}',
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('X-A')).toBe('b');
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  test('既定は GET、配列のヘッダーも通し、文字列以外の本文は送らない', async () => {
    const host = fakeHost();
    vi.stubGlobal('aoikoHost', host);
    await shimFetch('https://h.example/models', {
      headers: [['a', 'b'], ['c']],
      body: new Uint8Array(1),
    });
    expect(host.fetch).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ url: 'https://h.example/models', method: 'GET', headers: [['a', 'b']] }),
      undefined,
    );
  });

  test('aoikoHost の失敗は理由を持たない固定の TypeError になる', async () => {
    vi.stubGlobal(
      'aoikoHost',
      fakeHost(async () => {
        throw new Error('secret detail https://h.example/?key=k');
      }),
    );
    const error = await shimFetch('https://h.example/').catch((e: unknown) => e);
    expect(isHostFetchError(error)).toBe(true);
    expect(error).toBeInstanceOf(TypeError);
    expect(error).toBeInstanceOf(HostFetchError);
    expect((error as Error).message).toBe('network request failed');
    expect(isHostFetchError(new TypeError('network request failed'))).toBe(false);
  });

  test('始める前に中止されていれば aoikoHost を呼ばない', async () => {
    const host = fakeHost();
    vi.stubGlobal('aoikoHost', host);
    const controller = new ShimAbortController();
    controller.abort();
    const error = await shimFetch('https://h.example/', { signal: controller.signal }).catch(
      (e: unknown) => e,
    );
    expect((error as Error).name).toBe('AbortError');
    expect(host.fetch).not.toHaveBeenCalled();
  });

  test('応答を待つ間に中止すると AbortError で抜け、あとの応答は捨てる', async () => {
    let release: (value: HostReply) => void = () => {};
    vi.stubGlobal(
      'aoikoHost',
      fakeHost(
        () =>
          new Promise<HostReply>((resolve) => {
            release = resolve;
          }),
      ),
    );
    const controller = new ShimAbortController();
    const pending = shimFetch('https://h.example/', { signal: controller.signal });
    controller.abort();
    const error = await pending.catch((e: unknown) => e);
    expect((error as Error).name).toBe('AbortError');
    release(reply(200, '{}'));
  });
});

describe('installShims', () => {
  test('通信とタイマーは必ず aoikoHost を通し、無いものだけを補う', () => {
    const host = fakeHost();
    vi.stubGlobal('aoikoHost', host);
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('setTimeout', vi.fn());
    vi.stubGlobal('clearTimeout', vi.fn());
    vi.stubGlobal('URL', undefined);
    vi.stubGlobal('AbortController', undefined);
    const existingDomException = globalThis.DOMException;
    installShims();
    const scope = globalThis as unknown as Record<string, unknown>;
    expect(scope.fetch).toBe(shimFetch);
    expect(scope.URL).toBe(ShimURL);
    expect(scope.AbortController).toBe(ShimAbortController);
    expect(globalThis.DOMException).toBe(existingDomException);
    const callback = () => {};
    expect((scope.setTimeout as (cb: () => void, ms: number) => number)(callback, 5)).toBe(7);
    expect(host.setTimeout).toHaveBeenCalledExactlyOnceWith(callback, 5);
    (scope.clearTimeout as (id: number) => void)(7);
    expect(host.clearTimeout).toHaveBeenCalledExactlyOnceWith(7);
  });
});
