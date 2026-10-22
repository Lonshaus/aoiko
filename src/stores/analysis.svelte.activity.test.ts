import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
// このプロジェクトは __NATIVE__ = true（ネイティブ向けのビルド設定）。
vi.mock('../lib/analysis-notify', () => ({
  analysisNotifyPermission: vi.fn(async () => 'unsupported'),
  notifyAnalysisDone: vi.fn(),
}));

const { analysis } = await import('./analysis.svelte');

type Bridge = {
  analysisActivityBegin?: (job: string) => Promise<void>;
  analysisActivityEnd?: (job: string) => Promise<void>;
};

function installBridge(bridge: Bridge | undefined): void {
  vi.stubGlobal('window', { ...window, __aoikoNative: bridge });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function clean(): void {
  if (analysis.job !== null) {
    analysis.finish(analysis.job, 'cancelled');
  }
}

beforeEach(clean);

afterEach(() => {
  clean();
  vi.unstubAllGlobals();
});

describe('ネイティブ側では解析中の作業中宣言を OS へ伝える', () => {
  test('開始と終了に同じ識別子を渡す。識別子はネイティブ側の許す形', async () => {
    const begin = vi.fn(async () => {});
    const end = vi.fn(async () => {});
    installBridge({ analysisActivityBegin: begin, analysisActivityEnd: end });
    const job = analysis.begin('receipt')!;
    await flush();
    expect(begin).toHaveBeenCalledTimes(1);
    expect(end).not.toHaveBeenCalled();
    analysis.finish(job, 'done');
    await flush();
    expect(end).toHaveBeenCalledTimes(1);
    const id = (begin.mock.calls[0] as unknown as [string])[0];
    expect(id).toMatch(/^[A-Za-z0-9-]{1,128}$/);
    expect(end).toHaveBeenCalledWith(id);
  });

  test('解析ごとに識別子が変わる', async () => {
    const begin = vi.fn(async () => {});
    installBridge({ analysisActivityBegin: begin, analysisActivityEnd: async () => {} });
    analysis.finish(analysis.begin('receipt')!, 'done');
    analysis.finish(analysis.begin('order')!, 'done');
    await flush();
    const ids = begin.mock.calls.map((call) => (call as unknown as [string])[0]);
    expect(new Set(ids).size).toBe(2);
  });

  test('終了は開始の応答が返ってから送る', async () => {
    const order: string[] = [];
    let settle: () => void = () => {};
    installBridge({
      analysisActivityBegin: () =>
        new Promise<void>((resolve) => {
          order.push('begin');
          settle = () => {
            order.push('begin settled');
            resolve();
          };
        }),
      analysisActivityEnd: async () => {
        order.push('end');
      },
    });
    const job = analysis.begin('receipt')!;
    await flush();
    analysis.finish(job, 'done');
    await flush();
    expect(order).toEqual(['begin']);
    settle();
    await flush();
    expect(order).toEqual(['begin', 'begin settled', 'end']);
  });

  test('開始が失敗しても解析は進められ、終了は送られる', async () => {
    const end = vi.fn(async () => {});
    installBridge({
      analysisActivityBegin: async () => {
        throw 'denied';
      },
      analysisActivityEnd: end,
    });
    const job = analysis.begin('receipt');
    expect(job).not.toBeNull();
    expect(analysis.busy).toBe(true);
    analysis.finish(job!, 'done');
    await flush();
    expect(analysis.busy).toBe(false);
    expect(end).toHaveBeenCalledTimes(1);
  });

  test('終了が失敗しても例外は出ない', async () => {
    installBridge({
      analysisActivityBegin: async () => {},
      analysisActivityEnd: async () => {
        throw 'denied';
      },
    });
    const job = analysis.begin('receipt')!;
    expect(() => analysis.finish(job, 'done')).not.toThrow();
    await flush();
  });

  test('取消しでも終了を送り、そのあとの finish で二重には送らない', async () => {
    const end = vi.fn(async () => {});
    installBridge({ analysisActivityBegin: async () => {}, analysisActivityEnd: end });
    const job = analysis.begin('receipt')!;
    analysis.cancel();
    await flush();
    expect(end).toHaveBeenCalledTimes(1);
    analysis.finish(job, 'cancelled');
    await flush();
    expect(end).toHaveBeenCalledTimes(1);
  });

  test('失敗で終わった解析でも終了を送る', async () => {
    const end = vi.fn(async () => {});
    installBridge({ analysisActivityBegin: async () => {}, analysisActivityEnd: end });
    analysis.finish(analysis.begin('classify')!, 'failed');
    await flush();
    expect(end).toHaveBeenCalledTimes(1);
  });

  test('橋渡しが無い、または入口が無い環境では何もしない', async () => {
    installBridge(undefined);
    analysis.finish(analysis.begin('receipt')!, 'done');
    installBridge({});
    analysis.finish(analysis.begin('receipt')!, 'done');
    installBridge({ analysisActivityBegin: async () => {} });
    analysis.finish(analysis.begin('receipt')!, 'done');
    await flush();
    expect(analysis.busy).toBe(false);
  });
});
