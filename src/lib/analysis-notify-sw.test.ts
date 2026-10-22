import { beforeEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ANALYSIS_ROUTE } from '../stores/analysis.svelte';
// public/analysis-notify-sw.js は workbox の importScripts で読まれる classic script で、
// import できない。実ファイルを読み、偽の self を渡して評価する。
const source = readFileSync(resolve(process.cwd(), 'public/analysis-notify-sw.js'), 'utf8');

interface FakeClient {
  postMessage: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
}

function createClients(windowClients: FakeClient[]) {
  return {
    matchAll: vi.fn(async () => windowClients),
    openWindow: vi.fn(async () => null),
  };
}

function createClient(focus: () => Promise<unknown> = async () => ({})): FakeClient {
  return { postMessage: vi.fn(), focus: vi.fn(focus) };
}

type ClickHandler = (data: unknown, clients: ReturnType<typeof createClients>) => Promise<void>;

interface FakeSelf {
  addEventListener: ReturnType<typeof vi.fn>;
  clients: ReturnType<typeof createClients>;
  aoikoNotificationClick?: ClickHandler;
}

let fakeSelf: FakeSelf;

beforeEach(() => {
  fakeSelf = { addEventListener: vi.fn(), clients: createClients([]) };
  new Function('self', source)(fakeSelf);
});

function handler(): ClickHandler {
  return fakeSelf.aoikoNotificationClick!;
}

describe('既存のウィンドウがあるとき', () => {
  test('正しい種別ならそのウィンドウへ種別を postMessage し、focus する', async () => {
    const client = createClient();
    const clients = createClients([client]);
    await handler()({ kind: 'receipt' }, clients);
    expect(client.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'aoiko-open-route',
      kind: 'receipt',
    });
    expect(client.focus).toHaveBeenCalledTimes(1);
    expect(clients.openWindow).not.toHaveBeenCalled();
    expect(clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
  });

  test('focus が拒否されても postMessage は済んでいて、例外も出さない', async () => {
    const client = createClient(async () => {
      throw new Error('focus rejected');
    });
    const clients = createClients([client]);
    await expect(handler()({ kind: 'order' }, clients)).resolves.toBeUndefined();
    expect(client.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'aoiko-open-route',
      kind: 'order',
    });
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  test('複数あれば最初の 1 つだけに送る', async () => {
    const first = createClient();
    const second = createClient();
    await handler()({ kind: 'classify' }, createClients([first, second]));
    expect(first.postMessage).toHaveBeenCalledTimes(1);
    expect(second.postMessage).not.toHaveBeenCalled();
  });
});

describe('ウィンドウが無いとき', () => {
  test.each(Object.entries(ANALYSIS_ROUTE))(
    '%s は %s を同一オリジンの経路で開く',
    async (kind, path) => {
      const clients = createClients([]);
      await handler()({ kind }, clients);
      expect(clients.openWindow).toHaveBeenCalledExactlyOnceWith(path);
    },
  );
});

describe('信用しない入力', () => {
  const bad: [string, unknown][] = [
    ['未知の種別', { kind: 'unknown' }],
    ['経路そのもの', { kind: '/settings' }],
    ['別オリジンの URL', { kind: 'https://evil.example/' }],
    ['プロトコル相対の URL', { kind: '//evil.example/' }],
    ['Object の組込みプロパティ名', { kind: 'constructor' }],
    ['__proto__', { kind: '__proto__' }],
    ['kind が文字列でない', { kind: 1 }],
    ['kind が無く経路だけ', { url: 'https://evil.example/', path: '/settings' }],
    ['null', null],
    ['文字列', 'receipt'],
    ['undefined', undefined],
  ];

  test.each(bad)('%s では postMessage も openWindow もしない', async (_name, data) => {
    const client = createClient();
    const withWindow = createClients([client]);
    const withoutWindow = createClients([]);
    await handler()(data, withWindow);
    await handler()(data, withoutWindow);
    expect(client.postMessage).not.toHaveBeenCalled();
    expect(client.focus).not.toHaveBeenCalled();
    expect(withWindow.openWindow).not.toHaveBeenCalled();
    expect(withoutWindow.openWindow).not.toHaveBeenCalled();
  });

  test('正しい種別に余計な経路が付いていても、開くのは表から引いた経路だけ', async () => {
    const clients = createClients([]);
    await handler()({ kind: 'receipt', path: 'https://evil.example/', url: '/x' }, clients);
    expect(clients.openWindow).toHaveBeenCalledExactlyOnceWith('/receipt');
  });
});

describe('種別と経路の表', () => {
  test('ANALYSIS_ROUTE と同じ内容', () => {
    const literal = /const ROUTES = (\{[^}]*\});/.exec(source);
    expect(literal).not.toBeNull();
    const table = new Function(`return ${literal![1]}`)() as Record<string, string>;
    expect(table).toEqual(ANALYSIS_ROUTE);
  });
});

describe('notificationclick の登録', () => {
  test('通知を閉じ、データを渡して処理を waitUntil に載せる', async () => {
    const registered = fakeSelf.addEventListener.mock.calls.find(
      (call) => call[0] === 'notificationclick',
    );
    expect(registered).toBeDefined();
    const listener = registered![1] as (event: unknown) => void;
    const client = createClient();
    fakeSelf.clients = createClients([client]);
    const close = vi.fn();
    const waitUntil = vi.fn();
    listener({ notification: { close, data: { kind: 'order' } }, waitUntil });
    expect(close).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0]![0];
    expect(client.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'aoiko-open-route',
      kind: 'order',
    });
  });
});
