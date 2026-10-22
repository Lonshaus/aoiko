import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { setLocale } from '../paraglide/runtime';
import {
  analysisNotifyPermission,
  notifyAnalysisDone,
  requestAnalysisNotifyPermission,
} from './analysis-notify';
// vitest のこのプロジェクトは __NATIVE__ = true（ネイティブ向けのビルド設定）。
// ブラウザの通知 API には一切触れないことを、触れたら数えられる形で確かめる。
// 橋渡しの入口が無い環境（通知の仕組みが無い環境）は unsupported のまま。
const serviceWorkerGetter = vi.fn(() => ({ ready: new Promise(() => {}) }));
const requestPermission = vi.fn(async () => 'granted');

function stubBrowserApis(): void {
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    get: serviceWorkerGetter,
  });
}

function installBridge(bridge: Record<string, unknown> | undefined): void {
  vi.stubGlobal('window', { ...window, __aoikoNative: bridge });
}

beforeEach(() => {
  setLocale('ja', { reload: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  serviceWorkerGetter.mockClear();
  requestPermission.mockClear();
});

describe('ネイティブ向けの設定では通知 API に触れない', () => {
  test('橋渡しが無ければ許可の状態は unsupported', async () => {
    stubBrowserApis();
    await expect(analysisNotifyPermission()).resolves.toBe('unsupported');
  });

  test('notifyAnalysisDone は何もせず終わり、serviceWorker にも Notification にも触れない', async () => {
    stubBrowserApis();
    await expect(notifyAnalysisDone('receipt', 'done')).resolves.toBeUndefined();
    expect(serviceWorkerGetter).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  test('許可の要求も unsupported を返すだけで requestPermission を呼ばない', async () => {
    stubBrowserApis();
    await expect(requestAnalysisNotifyPermission()).resolves.toBe('unsupported');
    expect(requestPermission).not.toHaveBeenCalled();
    expect(serviceWorkerGetter).not.toHaveBeenCalled();
  });
});

describe('ネイティブ向けの設定では橋渡しの入口を使う', () => {
  test.each(['default', 'denied', 'granted', 'unsupported'] as const)(
    'notificationStatus の %s をそのまま返す',
    async (status) => {
      installBridge({ notificationStatus: vi.fn(async () => status) });
      await expect(analysisNotifyPermission()).resolves.toBe(status);
    },
  );

  test.each([
    ['入口が無い', {}],
    ['橋渡しが無い', undefined],
  ])('%s環境は unsupported', async (_name, bridge) => {
    installBridge(bridge);
    await expect(analysisNotifyPermission()).resolves.toBe('unsupported');
    await expect(requestAnalysisNotifyPermission()).resolves.toBe('unsupported');
  });

  test.each(['', 'Granted', 'authorized', 'provisional', 3, null, undefined, { granted: true }])(
    '知らない値 %j は許可として扱わず unsupported にする',
    async (value) => {
      installBridge({
        notificationStatus: vi.fn(async () => value),
        requestNotification: vi.fn(async () => value),
      });
      await expect(analysisNotifyPermission()).resolves.toBe('unsupported');
      await expect(requestAnalysisNotifyPermission()).resolves.toBe('unsupported');
    },
  );

  test('問い合わせが失敗したら unsupported（許可とは見なさない）', async () => {
    installBridge({
      notificationStatus: vi.fn(async () => {
        throw 'denied';
      }),
      requestNotification: vi.fn(async () => {
        throw 'denied';
      }),
    });
    await expect(analysisNotifyPermission()).resolves.toBe('unsupported');
    await expect(requestAnalysisNotifyPermission()).resolves.toBe('unsupported');
  });

  test('許可の要求は requestNotification の結果を返し、ブラウザの API には触れない', async () => {
    stubBrowserApis();
    const requestNotification = vi.fn(async () => 'granted');
    const notificationStatus = vi.fn(async () => 'default');
    installBridge({ requestNotification, notificationStatus });
    await expect(requestAnalysisNotifyPermission()).resolves.toBe('granted');
    expect(requestNotification).toHaveBeenCalledTimes(1);
    expect(notificationStatus).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(serviceWorkerGetter).not.toHaveBeenCalled();
  });

  test('通知は種別・結果・言語だけを渡す', async () => {
    const notifyAnalysis = vi.fn(async () => {});
    installBridge({ notificationStatus: async () => 'granted', notifyAnalysis });
    await notifyAnalysisDone('receipt', 'done');
    expect(notifyAnalysis).toHaveBeenCalledExactlyOnceWith('receipt', 'done', 'ja');
  });

  test.each([
    ['ja', 'ja'],
    ['en', 'en'],
    ['zh-TW', 'zh-TW'],
  ] as const)('言語 %s は %s で渡す', async (locale, expected) => {
    setLocale(locale, { reload: false });
    const notifyAnalysis = vi.fn(async () => {});
    installBridge({ notificationStatus: async () => 'granted', notifyAnalysis });
    await notifyAnalysisDone('classify', 'failed');
    expect(notifyAnalysis).toHaveBeenCalledExactlyOnceWith('classify', 'failed', expected);
  });

  test.each(['default', 'denied', 'unsupported'] as const)(
    '出す時点の許可が %s なら通知しない',
    async (status) => {
      const notifyAnalysis = vi.fn(async () => {});
      installBridge({ notificationStatus: async () => status, notifyAnalysis });
      await notifyAnalysisDone('order', 'done');
      expect(notifyAnalysis).not.toHaveBeenCalled();
    },
  );

  test('通知の入口が無ければ何もしない', async () => {
    installBridge({ notificationStatus: async () => 'granted' });
    await expect(notifyAnalysisDone('order', 'done')).resolves.toBeUndefined();
  });
});
