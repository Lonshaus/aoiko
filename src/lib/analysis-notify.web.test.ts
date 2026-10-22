import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { setLocale } from '../paraglide/runtime';
import { m } from '../paraglide/messages';
import {
  analysisNotifyPermission,
  notifyAnalysisDone,
  requestAnalysisNotifyPermission,
} from './analysis-notify';

const showNotification = vi.fn(async (_title: string, _options: NotificationOptions) => {});
const requestPermission = vi.fn(async () => 'granted');

function stubBrowser(permission: NotificationPermission, withServiceWorker = true): void {
  vi.stubGlobal('Notification', { permission, requestPermission });
  if (withServiceWorker) {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve({ showNotification }) },
    });
  }
}

beforeEach(() => {
  setLocale('ja', { reload: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  showNotification.mockClear();
  requestPermission.mockClear();
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
});
