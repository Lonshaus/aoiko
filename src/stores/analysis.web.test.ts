import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { db } from '../db/db';
import { setSetting } from '../lib/settings';
import { setLocale } from '../paraglide/runtime';
// このプロジェクトは __NATIVE__ = false（web のビルド設定）。通知の経路は本物の analysis-notify を通し、
// ブラウザの Notification と Service Worker の登録だけを代役にする。
type Grant = (lock: object | null) => unknown;

interface PendingRequest {
  name: string;
  signal: AbortSignal;
  callback: Grant;
  granted: boolean;
  withdrawn: boolean;
  // 付与されたコールバックが返した、まだ終わっていない Promise の数
  held: number;
}
// 付与の時期をテストが決められる Web Locks の代役。付与しない限り request は保留のまま。
// request は vi.fn で包まない。vi.fn は返した Promise を処理済みにするので、catch を外しても未処理の拒否として検出されなくなる。
function createFakeLocks() {
  const requests: PendingRequest[] = [];
  return {
    requests,
    request(name: string, options: { signal: AbortSignal }, callback: Grant): Promise<unknown> {
      const entry: PendingRequest = {
        name,
        signal: options.signal,
        callback,
        granted: false,
        withdrawn: false,
        held: 0,
      };
      requests.push(entry);
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          if (!entry.granted) {
            entry.withdrawn = true;
            reject(new DOMException('aborted', 'AbortError'));
          }
        });
      });
    },
    // 取り下げの後でも呼べる。実装が「終わった後の付与」を保持しないことを見る。
    grant(entry: PendingRequest): unknown {
      entry.granted = true;
      const result = entry.callback({});
      if (result instanceof Promise) {
        entry.held += 1;
        void result.then(() => {
          entry.held -= 1;
        });
      }
      return result;
    },
  };
}

function installLocks(locks: ReturnType<typeof createFakeLocks>): void {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
}
// タブごとにモジュールが別になる状況を、モジュールの読み込み直しで再現する。
async function loadStoreAsNewTab(tabId?: string) {
  vi.resetModules();
  if (tabId !== undefined) {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(tabId as ReturnType<typeof crypto.randomUUID>);
  }
  return (await import('./analysis.svelte')).analysis;
}

const showNotification = vi.fn(async (_title: string, _options: NotificationOptions) => {});
const shownList: { close: ReturnType<typeof vi.fn> }[] = [];
const getNotifications = vi.fn(async (_filter?: GetNotificationOptions) => shownList);
const requestPermission = vi.fn(async () => 'granted');

function stubBrowser(permission: NotificationPermission): void {
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('Notification', { permission, requestPermission });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: async () => ({ active: {}, showNotification, getNotifications }),
    },
  });
}

function setAway(hidden: boolean, focused: boolean): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => focused });
}
// 通知の判定は設定の読み出しを挟む非同期。呼ばれないことの確認は、その分だけ待ってから行う。
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const { analysis } = await import('./analysis.svelte');

function clean(): void {
  if (analysis.job !== null) {
    analysis.finish(analysis.job, 'cancelled');
  }
  analysis.viewing = null;
  analysis.unseen = {};
  analysis.notices = [];
}

beforeEach(async () => {
  vi.restoreAllMocks();
  setLocale('ja', { reload: false });
  await db.settings.clear();
  showNotification.mockReset().mockResolvedValue(undefined);
  getNotifications.mockClear();
  requestPermission.mockClear();
  shownList.length = 0;
  stubBrowser('granted');
  await setSetting('analysisNotifyEnabled', true);
  setAway(true, false);
  clean();
});

afterEach(async () => {
  clean();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Reflect.deleteProperty(navigator, 'locks');
  Reflect.deleteProperty(document, 'visibilityState');
  Reflect.deleteProperty(document, 'hasFocus');
  await db.settings.clear();
});

describe('離れている間の完了をブラウザの通知で知らせる', () => {
  test('別の画面を表示している間に終わっても通知し、印と toast も従来どおり付く', async () => {
    analysis.enter('order');
    analysis.finish(analysis.begin('receipt')!, 'done');
    await vi.waitFor(() => expect(showNotification).toHaveBeenCalledTimes(1));
    expect(showNotification.mock.calls[0]![1]).toMatchObject({
      tag: 'aoiko-analysis-receipt',
      data: { kind: 'receipt' },
    });
    expect(analysis.unseen.receipt).toBe('done');
    expect(analysis.notices).toHaveLength(1);
    expect(analysis.notices[0]).toMatchObject({ kind: 'receipt', outcome: 'done' });
  });

  test('解析した画面を表示したままタブが隠れても通知する。印と toast は従来どおり付かない', async () => {
    setAway(true, true);
    analysis.enter('receipt');
    analysis.finish(analysis.begin('receipt')!, 'failed');
    await vi.waitFor(() => expect(showNotification).toHaveBeenCalledTimes(1));
    expect(showNotification.mock.calls[0]![1]).toMatchObject({
      body: '領収書の解析に失敗しました',
      tag: 'aoiko-analysis-receipt',
    });
    expect(analysis.unseen.receipt).toBeUndefined();
    expect(analysis.notices).toHaveLength(0);
  });

  test('見えていてもフォーカスが無ければ通知する', async () => {
    setAway(false, false);
    analysis.finish(analysis.begin('classify')!, 'done');
    await vi.waitFor(() => expect(showNotification).toHaveBeenCalledTimes(1));
  });
});

describe('通知しない条件', () => {
  test('見えていてフォーカスもあるときは通知しない', async () => {
    setAway(false, true);
    analysis.finish(analysis.begin('receipt')!, 'done');
    await settle();
    expect(showNotification).not.toHaveBeenCalled();
  });

  test('設定がオフなら通知しない', async () => {
    await setSetting('analysisNotifyEnabled', false);
    analysis.finish(analysis.begin('receipt')!, 'done');
    await settle();
    expect(showNotification).not.toHaveBeenCalled();
  });

  test.each(['denied', 'default'] as const)(
    '出す時点の実際の許可が %s なら、設定がオンでも通知しない',
    async (permission) => {
      const job = analysis.begin('receipt')!;
      stubBrowser(permission);
      analysis.finish(job, 'done');
      await settle();
      expect(showNotification).not.toHaveBeenCalled();
    },
  );

  test('取消しでは通知しない', async () => {
    const job = analysis.begin('receipt')!;
    analysis.cancel();
    analysis.finish(job, 'cancelled');
    await settle();
    expect(showNotification).not.toHaveBeenCalled();
  });

  test('通知の経路は許可を求めない', async () => {
    stubBrowser('default');
    analysis.finish(analysis.begin('receipt')!, 'done');
    analysis.finish(analysis.begin('order')!, 'failed');
    await settle();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});

describe('失敗が利用者向けの未処理エラー表示へ届かない', () => {
  let rejections: unknown[];
  const onRejection = (reason: unknown) => {
    rejections.push(reason);
  };

  beforeEach(() => {
    rejections = [];
    process.on('unhandledRejection', onRejection);
  });

  afterEach(() => {
    process.off('unhandledRejection', onRejection);
  });

  test('showNotification が拒否されても未処理の拒否にならず、実行権は解放される', async () => {
    showNotification.mockRejectedValue(new TypeError('no permission'));
    const job = analysis.begin('receipt')!;
    expect(() => analysis.finish(job, 'done')).not.toThrow();
    await vi.waitFor(() => expect(showNotification).toHaveBeenCalledTimes(1));
    await settle();
    expect(rejections).toEqual([]);
    expect(analysis.busy).toBe(false);
  });

  test('ロックの要求が付与前に取り下げられても未処理の拒否にならない', async () => {
    const locks = createFakeLocks();
    installLocks(locks);
    const store = await loadStoreAsNewTab('tab-a');
    store.finish(store.begin('receipt')!, 'done');
    expect(locks.requests[0]!.withdrawn).toBe(true);
    await settle();
    expect(rejections).toEqual([]);
  });
});

describe('画面へ戻ったら、その画面の通知を閉じる', () => {
  test('acknowledge でその種別の tag の通知を閉じる', async () => {
    const shown = { close: vi.fn() };
    shownList.push(shown);
    analysis.acknowledge('order');
    await vi.waitFor(() => expect(shown.close).toHaveBeenCalledTimes(1));
    expect(getNotifications).toHaveBeenCalledExactlyOnceWith({ tag: 'aoiko-analysis-order' });
  });

  test('画面に入ると閉じる', async () => {
    const shown = { close: vi.fn() };
    shownList.push(shown);
    analysis.enter('classify');
    await vi.waitFor(() => expect(shown.close).toHaveBeenCalledTimes(1));
    expect(getNotifications).toHaveBeenCalledWith({ tag: 'aoiko-analysis-classify' });
  });

  test('通知を使えない環境では Service Worker に触れず、例外も出さない', async () => {
    vi.stubGlobal('Notification', undefined);
    expect(() => analysis.acknowledge('receipt')).not.toThrow();
    await flush();
    expect(getNotifications).not.toHaveBeenCalled();
  });
});

describe('解析中に保持する Web Lock', () => {
  test('同じ連番でも、タブが違えばロック名が違う', async () => {
    const locks = createFakeLocks();
    installLocks(locks);
    const tabA = await loadStoreAsNewTab('tab-a');
    const jobA = tabA.begin('receipt')!;
    const tabB = await loadStoreAsNewTab('tab-b');
    const jobB = tabB.begin('receipt')!;
    expect(jobA.id).toBe(jobB.id);
    expect(locks.requests).toHaveLength(2);
    expect(locks.requests[0]!.name).toBe(`aoiko-analysis-tab-a-${jobA.id}`);
    expect(locks.requests[1]!.name).toBe(`aoiko-analysis-tab-b-${jobB.id}`);
    tabA.finish(jobA, 'cancelled');
    tabB.finish(jobB, 'cancelled');
  });

  test('同じタブでも、解析ごとにロック名が違う', async () => {
    const locks = createFakeLocks();
    installLocks(locks);
    const store = await loadStoreAsNewTab('tab-a');
    store.finish(store.begin('receipt')!, 'done');
    store.finish(store.begin('order')!, 'done');
    expect(new Set(locks.requests.map((r) => r.name)).size).toBe(2);
  });

  test('付与を待たずに解析を始められ、付与が来なくても終われる', async () => {
    const locks = createFakeLocks();
    installLocks(locks);
    const store = await loadStoreAsNewTab('tab-a');
    const job = store.begin('receipt');
    expect(job).not.toBeNull();
    expect(store.busy).toBe(true);
    store.finish(job!, 'done');
    expect(store.busy).toBe(false);
  });

  test('付与の前に finish すると、要求を取り下げ、あとで付与が来ても何も保持しない', async () => {
    const locks = createFakeLocks();
    installLocks(locks);
    const store = await loadStoreAsNewTab('tab-a');
    const job = store.begin('receipt')!;
    store.finish(job, 'done');
    const entry = locks.requests[0]!;
    expect(entry.signal.aborted).toBe(true);
    expect(entry.withdrawn).toBe(true);
    expect(locks.grant(entry)).toBeUndefined();
    await flush();
    expect(entry.held).toBe(0);
  });

  test('付与の前に cancel しても、要求を取り下げ、あとで付与が来ても何も保持しない', async () => {
    const locks = createFakeLocks();
    installLocks(locks);
    const store = await loadStoreAsNewTab('tab-a');
    const job = store.begin('receipt')!;
    store.cancel();
    const entry = locks.requests[0]!;
    expect(entry.withdrawn).toBe(true);
    expect(locks.grant(entry)).toBeUndefined();
    store.finish(job, 'cancelled');
    await flush();
    expect(entry.held).toBe(0);
  });

  test('付与されたロックは、解析の間保持され、finish で解放される', async () => {
    const locks = createFakeLocks();
    installLocks(locks);
    const store = await loadStoreAsNewTab('tab-a');
    const job = store.begin('receipt')!;
    const entry = locks.requests[0]!;
    locks.grant(entry);
    await flush();
    expect(entry.held).toBe(1);
    store.finish(job, 'done');
    await flush();
    expect(entry.held).toBe(0);
  });

  test('付与されたロックは、cancel で手放される', async () => {
    const locks = createFakeLocks();
    installLocks(locks);
    const store = await loadStoreAsNewTab('tab-a');
    const job = store.begin('receipt')!;
    const entry = locks.requests[0]!;
    locks.grant(entry);
    store.cancel();
    await flush();
    expect(entry.held).toBe(0);
    store.finish(job, 'cancelled');
  });
});

describe('非セキュアコンテキスト（http の自己ホスト）', () => {
  let randomUUID: PropertyDescriptor | undefined;

  beforeEach(() => {
    randomUUID = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
  });

  afterEach(() => {
    if (randomUUID === undefined) {
      Reflect.deleteProperty(crypto, 'randomUUID');
    } else {
      Object.defineProperty(crypto, 'randomUUID', randomUUID);
    }
  });

  test('randomUUID も Web Locks も無くても、読み込めて解析を始めて終われる', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    const store = await loadStoreAsNewTab();
    const job = store.begin('receipt');
    expect(job).not.toBeNull();
    store.finish(job!, 'done');
    expect(store.busy).toBe(false);
    expect(store.begin('order')).not.toBeNull();
  });

  test('randomUUID が無くても、ロック名には読み込みごとの識別子が付く', async () => {
    const locks = createFakeLocks();
    installLocks(locks);
    const first = await loadStoreAsNewTab();
    first.finish(first.begin('receipt')!, 'done');
    const second = await loadStoreAsNewTab();
    second.finish(second.begin('receipt')!, 'done');
    const [a, b] = locks.requests.map((r) => r.name);
    expect(a).toMatch(/^aoiko-analysis-[0-9a-f-]{36}-1$/);
    expect(b).toMatch(/^aoiko-analysis-[0-9a-f-]{36}-1$/);
    expect(a).not.toBe(b);
  });
});
