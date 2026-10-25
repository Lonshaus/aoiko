import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { setLocale } from '../paraglide/runtime';
import { m } from '../paraglide/messages';
import {
  analysisNotifyPermission,
  closeAnalysisNotifications,
  notifyAnalysisDone,
  requestAnalysisNotifyPermission,
  webNotifySupport,
} from './analysis-notify';

const showNotification = vi.fn(async (_title: string, _options: NotificationOptions) => {});
const getNotifications = vi.fn(async (_filter?: GetNotificationOptions) => shown);
const requestPermission = vi.fn(async () => 'granted');
let shown: { close: () => void }[] = [];
let registration: unknown;
// ready は登録が無いと永久に待つ。触れたら分かるようにしておく。
const readyGetter = vi.fn(() => new Promise(() => {}));

function stubBrowser(permission: NotificationPermission, withServiceWorker = true): void {
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('Notification', { permission, requestPermission });
  if (withServiceWorker) {
    const serviceWorker = { getRegistration: vi.fn(async () => registration) };
    Object.defineProperty(serviceWorker, 'ready', { get: readyGetter });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });
  }
}

beforeEach(() => {
  setLocale('ja', { reload: false });
  shown = [];
  registration = { active: {}, showNotification, getNotifications };
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  showNotification.mockReset();
  getNotifications.mockClear();
  requestPermission.mockClear();
  readyGetter.mockClear();
});

describe('webNotifySupport', () => {
  test('すべて揃えば available', () => {
    stubBrowser('default');
    expect(webNotifySupport()).toBe('available');
  });

  test.each([
    ['isSecureContext が false', false],
    ['isSecureContext が無い', undefined],
  ])('%s なら insecure', (_name, value) => {
    stubBrowser('granted');
    vi.stubGlobal('isSecureContext', value);
    expect(webNotifySupport()).toBe('insecure');
  });

  test('Notification が無ければ unsupported', () => {
    stubBrowser('granted');
    vi.stubGlobal('Notification', undefined);
    expect(webNotifySupport()).toBe('unsupported');
  });

  test('serviceWorker が無ければ unsupported', () => {
    stubBrowser('granted', false);
    expect(webNotifySupport()).toBe('unsupported');
  });

  test('ネイティブの橋渡しが居れば unsupported', () => {
    stubBrowser('granted');
    vi.stubGlobal('window', { ...window, __aoikoNative: {} });
    expect(webNotifySupport()).toBe('unsupported');
  });
});

describe('analysisNotifyPermission', () => {
  test('Notification が無い環境は unsupported', async () => {
    vi.stubGlobal('Notification', undefined);
    await expect(analysisNotifyPermission()).resolves.toBe('unsupported');
  });

  test('serviceWorker が無い環境は unsupported', async () => {
    stubBrowser('granted', false);
    await expect(analysisNotifyPermission()).resolves.toBe('unsupported');
  });

  test('非セキュアコンテキストは unsupported', async () => {
    stubBrowser('granted');
    vi.stubGlobal('isSecureContext', false);
    await expect(analysisNotifyPermission()).resolves.toBe('unsupported');
  });

  test.each(['granted', 'denied', 'default'] as const)('%s はそのまま返す', async (permission) => {
    stubBrowser(permission);
    await expect(analysisNotifyPermission()).resolves.toBe(permission);
  });
});

describe('requestAnalysisNotifyPermission', () => {
  test('未決定のときだけブラウザに尋ねる', async () => {
    stubBrowser('default');
    await expect(requestAnalysisNotifyPermission()).resolves.toBe('granted');
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  test.each(['granted', 'denied'] as const)('%s のときは尋ねずに現状を返す', async (permission) => {
    stubBrowser(permission);
    await expect(requestAnalysisNotifyPermission()).resolves.toBe(permission);
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
// 許可の要求は利用者の操作の有効期間の中で呼んだときしか受け付けられない。await や microtask を挟む前に
// requestPermission が呼ばれていることを、呼び出した直後（同期）に確かめる。
describe('requestAnalysisNotifyPermission のユーザー操作の維持', () => {
  test('呼び出した直後に requestPermission が呼ばれている', () => {
    stubBrowser('default');
    const pending = requestAnalysisNotifyPermission();
    expect(requestPermission).toHaveBeenCalledTimes(1);
    return pending;
  });

  test('許可済み・拒否済みのときは尋ねない', () => {
    stubBrowser('granted');
    void requestAnalysisNotifyPermission();
    stubBrowser('denied');
    void requestAnalysisNotifyPermission();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});

describe('notifyAnalysisDone', () => {
  test('画面の名前と結果だけの本文・種別ごとの tag・{kind} だけの data で出す', async () => {
    stubBrowser('granted');
    await notifyAnalysisDone('receipt', 'done');
    expect(showNotification).toHaveBeenCalledTimes(1);
    const [title, options] = showNotification.mock.calls[0]!;
    expect(title).toBe('aoiko');
    expect(options).toEqual({
      body: '領収書の解析が終わりました',
      tag: 'aoiko-analysis-receipt',
      data: { kind: 'receipt' },
    });
    expect(options.body).toBe(m.analysis_notify_done({ name: m.nav_receipt() }));
  });

  test('失敗の本文は失敗を表し、種別ごとに tag が変わる', async () => {
    stubBrowser('granted');
    await notifyAnalysisDone('order', 'failed');
    const [, options] = showNotification.mock.calls[0]!;
    expect(options).toEqual({
      body: '注文取込の解析に失敗しました',
      tag: 'aoiko-analysis-order',
      data: { kind: 'order' },
    });
  });

  test('出す時点で許可が無ければ出さない', async () => {
    stubBrowser('denied');
    await notifyAnalysisDone('classify', 'done');
    expect(showNotification).not.toHaveBeenCalled();
  });

  test('未決定でも出さない（許可の要求は設定画面の操作でだけ行う）', async () => {
    stubBrowser('default');
    await notifyAnalysisDone('classify', 'done');
    expect(showNotification).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  test.each([
    ['登録が無い', undefined],
    ['登録はあるが動いている Service Worker が無い', { active: null, showNotification }],
  ])('%s ときは待たずに終わり、出さない', async (_name, value) => {
    stubBrowser('granted');
    registration = value;
    await expect(notifyAnalysisDone('receipt', 'done')).resolves.toBeUndefined();
    expect(showNotification).not.toHaveBeenCalled();
    expect(readyGetter).not.toHaveBeenCalled();
  });

  test('ready は使わない', async () => {
    stubBrowser('granted');
    await notifyAnalysisDone('receipt', 'done');
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(readyGetter).not.toHaveBeenCalled();
  });

  test('showNotification の拒否は呼び出し側へそのまま返す（握りつぶすのは呼び出し側）', async () => {
    stubBrowser('granted');
    showNotification.mockRejectedValue(new TypeError('x'));
    await expect(notifyAnalysisDone('receipt', 'done')).rejects.toThrow('x');
  });

  test.each(['receipt', 'order', 'classify'] as const)(
    '%s の本文には画面の名前と結果の決まった文しか入らない',
    async (kind) => {
      stubBrowser('granted');
      await notifyAnalysisDone(kind, 'done');
      await notifyAnalysisDone(kind, 'failed');
      const [done, failed] = showNotification.mock.calls.map((call) => call[1]);
      const name = { receipt: m.nav_receipt, order: m.nav_order_import, classify: m.nav_import }[
        kind
      ]();
      expect(done).toEqual({
        body: m.analysis_notify_done({ name }),
        tag: `aoiko-analysis-${kind}`,
        data: { kind },
      });
      expect(failed).toEqual({
        body: m.analysis_notify_failed({ name }),
        tag: `aoiko-analysis-${kind}`,
        data: { kind },
      });
    },
  );
});

describe('closeAnalysisNotifications', () => {
  test('その種別の tag の通知だけを問い合わせて閉じる', async () => {
    stubBrowser('granted');
    const close = vi.fn();
    shown = [{ close }, { close }];
    await closeAnalysisNotifications('order');
    expect(getNotifications).toHaveBeenCalledExactlyOnceWith({ tag: 'aoiko-analysis-order' });
    expect(close).toHaveBeenCalledTimes(2);
  });

  test('登録が無ければ何もしない', async () => {
    stubBrowser('granted');
    registration = undefined;
    await expect(closeAnalysisNotifications('order')).resolves.toBeUndefined();
    expect(getNotifications).not.toHaveBeenCalled();
  });

  test('通知を使えない環境では serviceWorker に触れない', async () => {
    stubBrowser('granted');
    vi.stubGlobal('isSecureContext', false);
    await closeAnalysisNotifications('order');
    expect(getNotifications).not.toHaveBeenCalled();
  });
});
