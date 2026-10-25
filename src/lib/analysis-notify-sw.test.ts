import { beforeEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ANALYSIS_ROUTE, analysisRouteFor } from '../stores/analysis.svelte';
// public/analysis-notify-sw.js は workbox の importScripts で読まれる classic script で、
// import できない。実ファイルを読み、偽の self を渡して評価する。
const source = readFileSync(resolve(process.cwd(), 'public/analysis-notify-sw.js'), 'utf8');
const ORIGIN = 'https://aoiko.example';

interface FakeClient {
  url: string;
  focused: boolean;
  visibilityState: string;
  postMessage: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
}

function createClients(windowClients: FakeClient[]) {
  return {
    matchAll: vi.fn(async () => windowClients),
    openWindow: vi.fn(async () => null),
  };
}

function createClient(
  options: {
    path?: string;
    url?: string;
    focused?: boolean;
    visibilityState?: string;
    focus?: () => Promise<unknown>;
  } = {},
): FakeClient {
  return {
    url: options.url ?? `${ORIGIN}${options.path ?? '/settings'}`,
    focused: options.focused ?? false,
    visibilityState: options.visibilityState ?? 'hidden',
    postMessage: vi.fn(),
    focus: vi.fn(options.focus ?? (async () => ({}))),
  };
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
    const client = createClient({
      focus: async () => {
        throw new Error('focus rejected');
      },
    });
    const clients = createClients([client]);
    await expect(handler()({ kind: 'order' }, clients)).resolves.toBeUndefined();
    expect(client.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'aoiko-open-route',
      kind: 'order',
    });
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  test('前面のウィンドウを選ぶ', async () => {
    const visible = createClient({ visibilityState: 'visible' });
    const focused = createClient({ focused: true, visibilityState: 'visible' });
    const hidden = createClient();
    await handler()({ kind: 'classify' }, createClients([hidden, visible, focused]));
    expect(focused.postMessage).toHaveBeenCalledTimes(1);
    expect(visible.postMessage).not.toHaveBeenCalled();
    expect(hidden.postMessage).not.toHaveBeenCalled();
  });

  test('前面が無ければ見えているウィンドウを選ぶ', async () => {
    const hidden = createClient();
    const visible = createClient({ visibilityState: 'visible' });
    await handler()({ kind: 'classify' }, createClients([hidden, visible]));
    expect(visible.postMessage).toHaveBeenCalledTimes(1);
    expect(hidden.postMessage).not.toHaveBeenCalled();
  });

  test('どれも隠れていれば最初の 1 つだけに送る', async () => {
    const first = createClient();
    const second = createClient();
    await handler()({ kind: 'classify' }, createClients([first, second]));
    expect(first.postMessage).toHaveBeenCalledTimes(1);
    expect(second.postMessage).not.toHaveBeenCalled();
  });

  test('SPA ではない実ファイルのタブは、前面でも選ばない', async () => {
    const licenses = createClient({ path: '/THIRD_PARTY_LICENSES.txt', focused: true });
    const app = createClient({ path: '/journal' });
    await handler()({ kind: 'receipt' }, createClients([licenses, app]));
    expect(licenses.postMessage).not.toHaveBeenCalled();
    expect(app.postMessage).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['著作権表示のタブだけ', [createClient({ path: '/THIRD_PARTY_LICENSES.txt', focused: true })]],
    ['/api/ のタブだけ', [createClient({ path: '/api/x', visibilityState: 'visible' })]],
    ['URL が読めないタブだけ', [createClient({ url: 'not a url', focused: true })]],
  ])('%s なら、新しいウィンドウで表の経路を開く', async (_name, windowClients) => {
    const clients = createClients(windowClients);
    await handler()({ kind: 'order' }, clients);
    expect(clients.openWindow).toHaveBeenCalledExactlyOnceWith('/order-import');
    for (const client of windowClients) {
      expect(client.postMessage).not.toHaveBeenCalled();
    }
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
    ['x', { kind: 'x' }],
    ['経路そのもの', { kind: '/settings' }],
    ['別オリジンの URL', { kind: 'https://evil.example/' }],
    ['プロトコル相対の URL', { kind: '//evil.example/' }],
    ['constructor', { kind: 'constructor' }],
    ['__proto__', { kind: '__proto__' }],
    ['toString', { kind: 'toString' }],
    ['kind が null', { kind: null }],
    ['kind が配列', { kind: [] }],
    ['kind が文字列でない', { kind: 1 }],
    ['kind が無く経路だけ', { url: 'https://evil.example/', path: '/settings' }],
    ['data が配列', []],
    ['null', null],
    ['文字列', 'receipt'],
    ['数値', 1],
    ['真偽値', true],
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
  // 継承した名前の値が経路の形をした文字列でも、種別として受け付けないことを確かめる。経路の形を調べるだけでは防げない。
  test('表の継承元にある名前は、値が経路の形をしていても種別として受け付けない', async () => {
    const inherited = 'aoikoInheritedKind';
    Object.defineProperty(Object.prototype, inherited, { configurable: true, value: '/settings' });
    try {
      const client = createClient();
      const withWindow = createClients([client]);
      const withoutWindow = createClients([]);
      await handler()({ kind: inherited }, withWindow);
      await handler()({ kind: inherited }, withoutWindow);
      expect(client.postMessage).not.toHaveBeenCalled();
      expect(withoutWindow.openWindow).not.toHaveBeenCalled();
      expect(analysisRouteFor(inherited)).toBeNull();
    } finally {
      Reflect.deleteProperty(Object.prototype, inherited);
    }
  });

  test('正しい種別に余計な経路が付いていても、開くのは表から引いた経路だけ', async () => {
    const clients = createClients([]);
    await handler()({ kind: 'receipt', path: 'https://evil.example/', url: '/x' }, clients);
    expect(clients.openWindow).toHaveBeenCalledExactlyOnceWith('/receipt');
  });
});
// SW の写しとアプリ側の検証関数が同じ値に同じ答えを返すこと。
describe('アプリ側の analysisRouteFor との一致', () => {
  const values: unknown[] = [
    'receipt',
    'order',
    'classify',
    'constructor',
    '__proto__',
    'toString',
    null,
    'x',
    [],
  ];

  test.each(values)('%j', async (value) => {
    const clients = createClients([]);
    await handler()({ kind: value }, clients);
    const expected = analysisRouteFor(value);
    if (expected === null) {
      expect(clients.openWindow).not.toHaveBeenCalled();
    } else {
      expect(clients.openWindow).toHaveBeenCalledExactlyOnceWith(expected);
    }
  });

  test('種別と経路の表は ANALYSIS_ROUTE と同じ内容', () => {
    const literal = /const ROUTES = (\{[^}]*\});/.exec(source);
    expect(literal).not.toBeNull();
    const table = new Function(`return ${literal![1]}`)() as Record<string, string>;
    expect(table).toEqual(ANALYSIS_ROUTE);
  });

  test('除外する実ファイルの一覧は vite.config.ts の navigateFallbackDenylist と同じ', () => {
    const config = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    const denylist = /navigateFallbackDenylist: (\[.*\]),/.exec(config);
    const copied = /const NON_APP_PATHS = (\[.*\]);/.exec(source);
    expect(denylist).not.toBeNull();
    expect(copied).not.toBeNull();
    expect(copied![1]).toBe(denylist![1]);
  });
});

describe('notificationclick の登録', () => {
  function registeredListener(): (event: unknown) => void {
    const registered = fakeSelf.addEventListener.mock.calls.find(
      (call) => call[0] === 'notificationclick',
    );
    expect(registered).toBeDefined();
    return registered![1] as (event: unknown) => void;
  }

  test('通知を閉じ、通知のデータと self.clients を渡した処理の Promise を waitUntil に載せる', () => {
    const listener = registeredListener();
    const pending = Promise.resolve();
    const spy = vi.fn(() => pending);
    fakeSelf.aoikoNotificationClick = spy;
    const close = vi.fn();
    const waitUntil = vi.fn();
    const data = { kind: 'order' };
    listener({ notification: { close, data }, waitUntil });
    expect(close).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledExactlyOnceWith(data, fakeSelf.clients);
    expect(waitUntil).toHaveBeenCalledExactlyOnceWith(pending);
  });

  test('本物の処理を通すと、既存のウィンドウへ送られる', async () => {
    const listener = registeredListener();
    const client = createClient();
    fakeSelf.clients = createClients([client]);
    const waitUntil = vi.fn();
    listener({ notification: { close: vi.fn(), data: { kind: 'order' } }, waitUntil });
    await waitUntil.mock.calls[0]![0];
    expect(client.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'aoiko-open-route',
      kind: 'order',
    });
  });
});
