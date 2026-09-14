import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mount, unmount, flushSync, createRawSnippet } from 'svelte';
import { setLocale } from '../paraglide/runtime';

const { default: ScrollX } = await import('./ScrollX.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const childrenSnippet = createRawSnippet(() => ({
  render: () => '<div>content</div>',
}));

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(() => {
  setLocale('ja', { reload: false });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  globalThis.ResizeObserver = RealResizeObserver;
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  if (container !== undefined) {
    container.remove();
    container = undefined;
  }
});

// 幅の変化だけで出入りする経路は scroll イベントを通らない。ResizeObserver を差し替えて
// その経路だけを呼ぶ。
let resizeCallbacks: ResizeObserverCallback[] = [];
let observedTargets: Element[] = [];
const RealResizeObserver = globalThis.ResizeObserver;

function stubResizeObserver(): void {
  resizeCallbacks = [];
  observedTargets = [];
  globalThis.ResizeObserver = class {
    constructor(cb: ResizeObserverCallback) {
      resizeCallbacks.push(cb);
    }
    observe(target: Element): void {
      observedTargets.push(target);
    }
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

function setSize(el: HTMLDivElement, scrollWidth: number, clientWidth: number): void {
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true });
}

function scroller(c: HTMLElement): HTMLDivElement {
  const el = c.querySelector('.scroll-x');
  if (el === null) {
    throw new Error('scroller が見つからない');
  }
  return el as HTMLDivElement;
}

function rightHintVisible(c: HTMLElement): boolean {
  return c.querySelector('[data-scroll-hint="right"]') !== null;
}
// happy-dom はレイアウトを計算しないため、scrollWidth/clientWidth/scrollLeft を手動で定義して溢れを再現する。
function setOverflow(
  el: HTMLDivElement,
  scrollWidth: number,
  clientWidth: number,
  scrollLeft: number,
): void {
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true });
  Object.defineProperty(el, 'scrollLeft', { value: scrollLeft, configurable: true });
  el.dispatchEvent(new Event('scroll'));
}

describe('ScrollX', () => {
  test('溢れがない場合はヒントを出さない', async () => {
    instance = mount(ScrollX, { target: container!, props: { children: childrenSnippet } });
    flushSync();
    const el = scroller(container!);
    setOverflow(el, 100, 100, 0);
    flushSync();
    await waitFor(() => true);
    expect(rightHintVisible(container!)).toBe(false);
    expect(container!.querySelector('.from-card.to-transparent')).toBeNull();
  });

  test('先頭にいるときは右ヒントのみ', async () => {
    instance = mount(ScrollX, { target: container!, props: { children: childrenSnippet } });
    flushSync();
    const el = scroller(container!);
    setOverflow(el, 500, 100, 0);
    flushSync();
    await waitFor(() => rightHintVisible(container!));
    expect(rightHintVisible(container!)).toBe(true);
    expect(container!.querySelector('.bg-gradient-to-r')).toBeNull();
  });

  test('中間までスクロールすると両方のヒントが出る', async () => {
    instance = mount(ScrollX, { target: container!, props: { children: childrenSnippet } });
    flushSync();
    const el = scroller(container!);
    setOverflow(el, 500, 100, 200);
    flushSync();
    await waitFor(
      () => rightHintVisible(container!) && container!.querySelector('.bg-gradient-to-r') !== null,
    );
    expect(rightHintVisible(container!)).toBe(true);
    expect(container!.querySelector('.bg-gradient-to-r')).not.toBeNull();
  });

  test('スクロールせず幅が縮んだだけでも右ヒントが出る', async () => {
    stubResizeObserver();
    instance = mount(ScrollX, { target: container!, props: { children: childrenSnippet } });
    flushSync();
    const el = scroller(container!);
    setSize(el, 100, 100);
    expect(rightHintVisible(container!)).toBe(false);
    setSize(el, 500, 100);
    for (const cb of resizeCallbacks) {
      cb([], {} as ResizeObserver);
    }
    flushSync();
    await waitFor(() => rightHintVisible(container!));
    expect(rightHintVisible(container!)).toBe(true);
  });

  test('容器だけでなく中身も観測する', async () => {
    stubResizeObserver();
    instance = mount(ScrollX, { target: container!, props: { children: childrenSnippet } });
    flushSync();
    const el = scroller(container!);
    // 容器の大きさが変わらず中身だけ伸びる場合は、子を観測していないと気付けない。
    expect(observedTargets).toContain(el);
    expect(observedTargets).toContain(el.firstElementChild);
  });

  test('末尾までスクロールすると左ヒントのみ', async () => {
    instance = mount(ScrollX, { target: container!, props: { children: childrenSnippet } });
    flushSync();
    const el = scroller(container!);
    setOverflow(el, 500, 100, 400);
    flushSync();
    await waitFor(() => !rightHintVisible(container!));
    expect(rightHintVisible(container!)).toBe(false);
    expect(container!.querySelector('.bg-gradient-to-r')).not.toBeNull();
  });
});
