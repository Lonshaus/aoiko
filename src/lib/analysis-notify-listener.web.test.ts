import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { router } from '../router.svelte';
import { installAnalysisNotifyListener } from './analysis-notify-listener';
// このプロジェクトは __NATIVE__ = false（web のビルド設定）。
let goto: MockInstance<typeof router.goto>;

beforeEach(() => {
  goto = vi.spyOn(router, 'goto').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('installAnalysisNotifyListener', () => {
  test('serviceWorker の message を受けて移動する（window の message は見ない）', () => {
    const serviceWorker = new EventTarget();
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });
    installAnalysisNotifyListener();
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'aoiko-open-route', kind: 'order' } }),
    );
    expect(goto).not.toHaveBeenCalled();
    serviceWorker.dispatchEvent(
      new MessageEvent('message', { data: { type: 'aoiko-open-route', kind: 'order' } }),
    );
    expect(goto).toHaveBeenCalledExactlyOnceWith('/order-import');
  });

  test('不正なメッセージでは移動しない', () => {
    const serviceWorker = new EventTarget();
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });
    installAnalysisNotifyListener();
    serviceWorker.dispatchEvent(new MessageEvent('message', { data: { kind: 'receipt' } }));
    serviceWorker.dispatchEvent(
      new MessageEvent('message', { data: { type: 'aoiko-open-route', kind: 'x' } }),
    );
    expect(goto).not.toHaveBeenCalled();
  });

  test('serviceWorker が無い環境では何もしない', () => {
    expect(() => installAnalysisNotifyListener()).not.toThrow();
  });
});
