import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../lib/analysis-notify', () => ({
  analysisNotifyPermission: vi.fn(async () => 'unsupported'),
  notifyAnalysisDone: vi.fn(),
}));

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
async function loadStoreAsNewTab(tabId: string) {
  vi.resetModules();
  const uuid = tabId as ReturnType<typeof crypto.randomUUID>;
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(uuid);
  return (await import('./analysis.svelte')).analysis;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'locks');
  vi.restoreAllMocks();
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
    expect(locks.requests[0]!.name).not.toBe(locks.requests[1]!.name);
    expect(locks.requests[0]!.name).toContain('tab-a');
    expect(locks.requests[1]!.name).toContain('tab-b');
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

  test('Web Locks が無い環境でも解析は普通に始まって終わる', async () => {
    const store = await loadStoreAsNewTab('tab-a');
    const job = store.begin('receipt');
    expect(job).not.toBeNull();
    store.finish(job!, 'done');
    expect(store.busy).toBe(false);
  });
});
