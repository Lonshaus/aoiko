import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { router } from '../router.svelte';
import { analysisRouteFor, ANALYSIS_ROUTE, type AnalysisKind } from '../stores/analysis.svelte';
import { installAnalysisNotifyListener } from './analysis-notify-listener';
// このプロジェクトは __NATIVE__ = false（web のビルド設定）。happy-dom には ServiceWorker が無いので代役を置く。
class FakeServiceWorker {}

let goto: MockInstance<typeof router.goto>;
let serviceWorker: EventTarget;

function send(data: unknown, source: unknown = new FakeServiceWorker()): void {
  serviceWorker.dispatchEvent(
    new MessageEvent('message', { data, source: source as MessageEventSource }),
  );
}

beforeEach(() => {
  goto = vi.spyOn(router, 'goto').mockImplementation(() => {});
  vi.stubGlobal('ServiceWorker', FakeServiceWorker);
  serviceWorker = new EventTarget();
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('installAnalysisNotifyListener', () => {
  test.each(Object.keys(ANALYSIS_ROUTE) as AnalysisKind[])(
    'Service Worker からの %s のメッセージでその画面の経路へ移る',
    (kind) => {
      installAnalysisNotifyListener();
      send({ type: 'aoiko-open-route', kind });
      expect(goto).toHaveBeenCalledExactlyOnceWith(ANALYSIS_ROUTE[kind]);
    },
  );

  test('window の message は見ない', () => {
    installAnalysisNotifyListener();
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'aoiko-open-route', kind: 'order' } }),
    );
    expect(goto).not.toHaveBeenCalled();
  });

  test.each([
    ['送り主が無い', null],
    ['送り主が window', window],
    ['送り主が MessagePort', new MessageChannel().port1],
    ['送り主が Service Worker に似せたオブジェクト', { postMessage: () => {} }],
  ])('%s メッセージでは移動しない', (_name, source) => {
    installAnalysisNotifyListener();
    send({ type: 'aoiko-open-route', kind: 'order' }, source);
    expect(goto).not.toHaveBeenCalled();
  });

  test('ServiceWorker の型そのものが無い環境では、どのメッセージでも移動しない', () => {
    installAnalysisNotifyListener();
    vi.stubGlobal('ServiceWorker', undefined);
    send({ type: 'aoiko-open-route', kind: 'order' });
    expect(goto).not.toHaveBeenCalled();
  });

  test.each([
    ['constructor', { type: 'aoiko-open-route', kind: 'constructor' }],
    ['__proto__', { type: 'aoiko-open-route', kind: '__proto__' }],
    ['toString', { type: 'aoiko-open-route', kind: 'toString' }],
    ['kind が null', { type: 'aoiko-open-route', kind: null }],
    ['未知の種別', { type: 'aoiko-open-route', kind: 'x' }],
    ['kind が配列', { type: 'aoiko-open-route', kind: [] }],
    ['経路そのもの', { type: 'aoiko-open-route', kind: '/receipt' }],
    ['type が無い', { kind: 'receipt' }],
    ['type が違う', { type: 'other', kind: 'receipt' }],
    ['data が null', null],
    ['data が配列', []],
    ['data が文字列', 'receipt'],
    ['data が数値', 1],
  ])('%s では移動しない', (_name, data) => {
    installAnalysisNotifyListener();
    send(data);
    expect(goto).not.toHaveBeenCalled();
  });

  test('serviceWorker が無い環境では何もしない', () => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    expect(() => installAnalysisNotifyListener()).not.toThrow();
  });
});

describe('analysisRouteFor', () => {
  test.each(Object.entries(ANALYSIS_ROUTE))('%s は %s', (kind, path) => {
    expect(analysisRouteFor(kind)).toBe(path);
  });

  test.each(['constructor', '__proto__', 'toString', null, 'x', [], undefined, 1, '/receipt'])(
    '%j は null',
    (value) => {
      expect(analysisRouteFor(value)).toBeNull();
    },
  );
});
