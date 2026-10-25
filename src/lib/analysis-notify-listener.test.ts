import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { router } from '../router.svelte';
import { ANALYSIS_ROUTE, type AnalysisKind } from '../stores/analysis.svelte';
import {
  installAnalysisNotifyListener,
  openAnalysisRouteFromMessage,
  openAnalysisRouteFromPayload,
} from './analysis-notify-listener';

let goto: MockInstance<typeof router.goto>;

beforeEach(() => {
  goto = vi.spyOn(router, 'goto').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('openAnalysisRouteFromMessage', () => {
  test.each(Object.keys(ANALYSIS_ROUTE) as AnalysisKind[])(
    '%s の正しいメッセージはその画面の経路へ移る',
    (kind) => {
      openAnalysisRouteFromMessage({ type: 'aoiko-open-route', kind });
      expect(goto).toHaveBeenCalledExactlyOnceWith(ANALYSIS_ROUTE[kind]);
    },
  );

  test.each([
    ['未知の種別', { type: 'aoiko-open-route', kind: 'unknown' }],
    ['経路そのもの', { type: 'aoiko-open-route', kind: '/settings' }],
    ['別オリジンの URL', { type: 'aoiko-open-route', kind: 'https://evil.example/receipt' }],
    ['Object の組込みプロパティ名', { type: 'aoiko-open-route', kind: 'constructor' }],
    ['__proto__', { type: 'aoiko-open-route', kind: '__proto__' }],
    ['kind が文字列でない', { type: 'aoiko-open-route', kind: 1 }],
    ['kind が無い', { type: 'aoiko-open-route' }],
    ['type が違う', { type: 'other', kind: 'receipt' }],
    ['type が無い', { kind: 'receipt' }],
    ['null', null],
    ['文字列', 'receipt'],
    ['数値', 1],
    ['undefined', undefined],
  ])('%s のメッセージでは移動しない', (_name, data) => {
    openAnalysisRouteFromMessage(data);
    expect(goto).not.toHaveBeenCalled();
  });

  test('メッセージに経路が混ざっていても、使うのは種別から引いた経路だけ', () => {
    openAnalysisRouteFromMessage({
      type: 'aoiko-open-route',
      kind: 'receipt',
      path: 'https://evil.example/',
      url: '/settings',
    });
    expect(goto).toHaveBeenCalledExactlyOnceWith('/receipt');
  });
});

describe('openAnalysisRouteFromPayload（ネイティブの通知のクリック）', () => {
  test.each(Object.keys(ANALYSIS_ROUTE) as AnalysisKind[])(
    '%s の合図はその画面の経路へ移る',
    (kind) => {
      openAnalysisRouteFromPayload({ kind });
      expect(goto).toHaveBeenCalledExactlyOnceWith(ANALYSIS_ROUTE[kind]);
    },
  );

  test.each([
    ['未知の種別', { kind: 'unknown' }],
    ['経路そのもの', { kind: '/settings' }],
    ['別オリジンの URL', { kind: 'https://evil.example/receipt' }],
    ['Object の組込みプロパティ名', { kind: 'constructor' }],
    ['__proto__', { kind: '__proto__' }],
    ['kind が文字列でない', { kind: 1 }],
    ['kind が配列', { kind: ['receipt'] }],
    ['kind が無い', {}],
    ['null', null],
    ['文字列', 'receipt'],
    ['経路の文字列', '/receipt'],
    ['数値', 1],
    ['undefined', undefined],
  ])('%s では移動しない', (_name, data) => {
    openAnalysisRouteFromPayload(data);
    expect(goto).not.toHaveBeenCalled();
  });

  test('合図に経路が混ざっていても、使うのは種別から引いた経路だけ', () => {
    openAnalysisRouteFromPayload({
      kind: 'order',
      path: 'https://evil.example/',
      url: '/settings',
    });
    expect(goto).toHaveBeenCalledExactlyOnceWith('/order-import');
  });
});

describe('installAnalysisNotifyListener（ネイティブ向けの設定）', () => {
  function installBridge(onAnalysisOpen: unknown): void {
    vi.stubGlobal('window', { ...window, __aoikoNative: { onAnalysisOpen } });
  }

  test('橋渡しの合図を購読し、正しい合図で移動する。serviceWorker には触れない', () => {
    const serviceWorkerGetter = vi.fn(() => new EventTarget());
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      get: serviceWorkerGetter,
    });
    let callback: (payload: unknown) => void = () => {};
    const onAnalysisOpen = vi.fn(async (next: (payload: unknown) => void) => {
      callback = next;
      return () => {};
    });
    installBridge(onAnalysisOpen);
    installAnalysisNotifyListener();
    expect(onAnalysisOpen).toHaveBeenCalledTimes(1);
    expect(serviceWorkerGetter).not.toHaveBeenCalled();
    callback({ kind: 'classify' });
    expect(goto).toHaveBeenCalledExactlyOnceWith('/import');
  });

  test('偽造された合図（未知の種別・経路・文字列でない値）では移動しない', () => {
    let callback: (payload: unknown) => void = () => {};
    installBridge(
      vi.fn(async (next: (payload: unknown) => void) => {
        callback = next;
        return () => {};
      }),
    );
    installAnalysisNotifyListener();
    callback({ kind: 'unknown' });
    callback({ kind: '/receipt' });
    callback({ kind: { toString: () => 'receipt' } });
    callback('/receipt');
    callback(null);
    expect(goto).not.toHaveBeenCalled();
  });

  test('購読に失敗しても例外は出ない', async () => {
    installBridge(
      vi.fn(async () => {
        throw 'denied';
      }),
    );
    expect(() => installAnalysisNotifyListener()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  test('橋渡しが無い、または入口が無い環境では何もしない', () => {
    expect(() => installAnalysisNotifyListener()).not.toThrow();
    installBridge(undefined);
    expect(() => installAnalysisNotifyListener()).not.toThrow();
  });
});

describe('installAnalysisNotifyListener（iOS 形の橋渡し）', () => {
  test('正しい種別だけその画面へ移り、それ以外は何もしない', async () => {
    let deliver: (payload: unknown) => void = () => {};
    const onAnalysisOpen = vi.fn(async (next: (payload: unknown) => void) => {
      deliver = next;
      return () => {};
    });
    vi.stubGlobal('window', {
      ...window,
      __aoikoNative: {
        runAnalysis: vi.fn(),
        takeAnalysis: vi.fn(),
        cancelAnalysis: vi.fn(),
        notificationStatus: vi.fn(async () => 'granted'),
        requestNotification: vi.fn(async () => 'granted'),
        onAnalysisOpen,
      },
    });
    installAnalysisNotifyListener();
    expect(onAnalysisOpen).toHaveBeenCalledTimes(1);
    for (const kind of Object.keys(ANALYSIS_ROUTE) as AnalysisKind[]) {
      goto.mockClear();
      deliver({ kind });
      expect(goto).toHaveBeenCalledExactlyOnceWith(ANALYSIS_ROUTE[kind]);
    }
    goto.mockClear();
    for (const bad of [
      { kind: 'constructor' },
      { kind: '__proto__' },
      { kind: '/settings' },
      { kind: 1 },
      'receipt',
      null,
      [],
    ]) {
      deliver(bad);
    }
    expect(goto).not.toHaveBeenCalled();
  });
});
// 呼び出し側は条件を持たない。web とネイティブの出し分けはリスナーの中だけにある。
describe('main.ts での呼び出し', () => {
  test('installAnalysisNotifyListener() を最上位で無条件に呼ぶ', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const lines = source.split('\n');
    const at = lines.findIndex((line) => line.includes('installAnalysisNotifyListener()'));
    expect(lines[at]).toBe('installAnalysisNotifyListener();');
    expect(source.split('installAnalysisNotifyListener()').length).toBe(2);
    const before = lines
      .slice(0, at)
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');
    const depth = [...before].reduce(
      (count, char) => count + (char === '{' ? 1 : char === '}' ? -1 : 0),
      0,
    );
    expect(depth).toBe(0);
  });
});
