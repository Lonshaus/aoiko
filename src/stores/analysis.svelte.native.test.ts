import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { db } from '../db/db';
import { setSetting } from '../lib/settings';
import { setLocale } from '../paraglide/runtime';
// このプロジェクトは __NATIVE__ = true（ネイティブ向けのビルド設定）。通知だけを持つ環境の橋渡しと同じ形の代役を注入し、
// 本物の analysis-notify を通して、ブラウザの通知 API には触れないことを数えて確かめる。
const serviceWorkerGetter = vi.fn(() => ({ getRegistration: async () => undefined }));
const notificationPermissionGetter = vi.fn(() => 'granted');
const browserRequestPermission = vi.fn(async () => 'granted');

function desktopBridge() {
  return {
    notificationStatus: vi.fn(async () => 'granted'),
    requestNotification: vi.fn(async () => 'granted'),
    notifyAnalysis: vi.fn(async () => {}),
    analysisActivityBegin: vi.fn(async (_job: string) => {}),
    analysisActivityEnd: vi.fn(async (_job: string) => {}),
    onAnalysisOpen: vi.fn(async () => () => {}),
  };
}

// モジュールを読み込み直すと router も作り直され window.location を読むため、window は差し替えずに足す。
function installBridge(bridge: Record<string, unknown>): void {
  Object.defineProperty(window, '__aoikoNative', { configurable: true, value: bridge });
}

function setAway(hidden: boolean, focused: boolean): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => focused });
}

async function loadStore() {
  vi.resetModules();
  return (await import('./analysis.svelte')).analysis;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  setLocale('ja', { reload: false });
  await db.settings.clear();
  await setSetting('analysisNotifyEnabled', true);
  setAway(true, false);
  const notification = { requestPermission: browserRequestPermission };
  Object.defineProperty(notification, 'permission', { get: notificationPermissionGetter });
  vi.stubGlobal('Notification', notification);
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    get: serviceWorkerGetter,
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, '__aoikoNative');
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Reflect.deleteProperty(navigator, 'locks');
  Reflect.deleteProperty(document, 'visibilityState');
  Reflect.deleteProperty(document, 'hasFocus');
  serviceWorkerGetter.mockClear();
  notificationPermissionGetter.mockClear();
  browserRequestPermission.mockClear();
  await db.settings.clear();
});

function expectBrowserApisUntouched(): void {
  expect(serviceWorkerGetter).not.toHaveBeenCalled();
  expect(notificationPermissionGetter).not.toHaveBeenCalled();
  expect(browserRequestPermission).not.toHaveBeenCalled();
}

describe('デスクトップ形の橋渡し', () => {
  test('離れている間の完了で notifyAnalysis を種別・結果・言語で 1 回呼ぶ。ブラウザの API には触れない', async () => {
    const bridge = desktopBridge();
    installBridge(bridge);
    const store = await loadStore();
    store.enter('order');
    store.finish(store.begin('receipt')!, 'done');
    await vi.waitFor(() => expect(bridge.notifyAnalysis).toHaveBeenCalledTimes(1));
    expect(bridge.notifyAnalysis).toHaveBeenCalledWith('receipt', 'done', 'ja');
    await flush();
    expect(bridge.notifyAnalysis).toHaveBeenCalledTimes(1);
    expectBrowserApisUntouched();
  });

  test('画面に入っても（通知を閉じる処理でも）ブラウザの API には触れない', async () => {
    installBridge(desktopBridge());
    const store = await loadStore();
    store.enter('receipt');
    store.acknowledge('classify');
    await flush();
    expectBrowserApisUntouched();
  });

  test('Web Locks が無くても、読み込みごとに作業中宣言の識別子が変わり、許される形のまま', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    const ids: string[] = [];
    for (let load = 0; load < 2; load += 1) {
      const bridge = desktopBridge();
      installBridge(bridge);
      const store = await loadStore();
      store.finish(store.begin('receipt')!, 'cancelled');
      await vi.waitFor(() => expect(bridge.analysisActivityBegin).toHaveBeenCalledTimes(1));
      ids.push(bridge.analysisActivityBegin.mock.calls[0]![0]);
    }
    const [first, second] = ids;
    expect(first).toMatch(/^[A-Za-z0-9-]{1,128}$/);
    expect(second).toMatch(/^[A-Za-z0-9-]{1,128}$/);
    expect(first).not.toBe(second);
  });
});
