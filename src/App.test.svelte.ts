// ハンバーガーメニューを外側タップ・Escape で閉じられること。SupportDialog と違い
// <dialog> ではなく通常要素なので、暗幕・キー操作を自前で用意している。

import { describe, expect, test, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const registered: { onOfflineReady?: () => void }[] = [];

vi.mock('virtual:pwa-register', () => ({
  registerSW: (options: { onOfflineReady?: () => void }) => {
    registered.push(options);
    return async () => {};
  },
}));

const { default: App } = await import('./App.svelte');
const { analysis } = await import('./stores/analysis.svelte');
const { m } = await import('./paraglide/messages');

let target: HTMLElement | null = null;
let component: Record<string, unknown> | null = null;

function render(): void {
  target = document.createElement('div');
  document.body.appendChild(target);
  component = mount(App, { target });
  flushSync();
}

function openMenu(): void {
  const toggle = target?.querySelector<HTMLButtonElement>('header button[aria-label]');
  toggle?.click();
  flushSync();
}

afterEach(() => {
  registered.length = 0;
  if (component !== null) {
    unmount(component);
    component = null;
  }
  target?.remove();
  target = null;
});

describe('モバイルメニュー', () => {
  test('外側の暗幕を押すと閉じる', () => {
    render();
    openMenu();
    expect(target?.querySelector('header nav.lg\\:hidden')).not.toBeNull();
    const dismiss = target?.querySelector<HTMLButtonElement>('button.fixed.inset-0');
    dismiss?.click();
    flushSync();
    expect(target?.querySelector('header nav.lg\\:hidden')).toBeNull();
  });

  test('Escape を押すと閉じる', () => {
    render();
    openMenu();
    expect(target?.querySelector('header nav.lg\\:hidden')).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushSync();
    expect(target?.querySelector('header nav.lg\\:hidden')).toBeNull();
  });
});

describe('更新・オフラインのカード', () => {
  test('カード用の余白は 1 画面分の高さの枠の内側に置く', () => {
    render();
    registered[0]?.onOfflineReady?.();
    flushSync();
    const spacer = target?.querySelector('[aria-hidden="true"].print\\:hidden');
    expect(spacer).not.toBeNull();
    expect(target?.querySelector('.min-h-screen')?.contains(spacer!)).toBe(true);
  });
});

describe('ナビの解析バッジ', () => {
  afterEach(() => {
    if (analysis.job !== null) {
      analysis.finish(analysis.job, 'cancelled');
    }
    analysis.viewing = null;
    analysis.unseen = {};
    analysis.notices = [];
  });

  function badges(kind: string): HTMLElement[] {
    return Array.from(
      target?.querySelectorAll<HTMLElement>(`[data-analysis-badge="${kind}"]`) ?? [],
    );
  }

  function wideMarks(kind: string): HTMLElement[] {
    return badges(kind).filter((el) => el.closest('nav')?.classList.contains('hidden'));
  }

  function menuMark(): HTMLElement | null {
    return target?.querySelector<HTMLElement>('header button [data-menu-indicator]') ?? null;
  }

  function menuDescription(): string | null {
    const id = target?.querySelector('header button[aria-label]')?.getAttribute('aria-describedby');
    if (id === null || id === undefined) {
      return null;
    }
    return target?.querySelector(`#${id}`)?.textContent ?? null;
  }

  test('解析中の画面のナビ項目に印が付き、メニューを開くと文字の表示も出る', () => {
    render();
    expect(badges('receipt')).toHaveLength(0);
    const job = analysis.begin('receipt')!;
    flushSync();
    expect(badges('receipt')).toHaveLength(1);
    const mark = wideMarks('receipt')[0]!;
    expect(mark.getAttribute('data-state')).toBe('running');
    expect(mark.getAttribute('title')).toBe(m.analysis_badge_running());
    expect(mark.querySelector('.sr-only')?.textContent).toBe(m.analysis_badge_running());
    expect(mark.textContent).toBe(m.analysis_badge_running());
    expect(mark.className).toContain('--analysis-running');
    expect(mark.closest('a')?.getAttribute('href')).toBe('/receipt');
    openMenu();
    expect(badges('receipt')).toHaveLength(2);
    const text = badges('receipt').find((el) => !wideMarks('receipt').includes(el))!;
    expect(text.textContent).toBe(m.analysis_badge_running());
    expect(text.querySelector('[aria-hidden="true"]')?.className).toContain('--analysis-running');
    analysis.finish(job, 'cancelled');
    flushSync();
    expect(badges('receipt')).toHaveLength(0);
  });

  test('3 つの解析画面それぞれの項目に付き、他の項目には付かない', () => {
    render();
    for (const [kind, href] of [
      ['classify', '/import'],
      ['order', '/order-import'],
      ['receipt', '/receipt'],
    ] as const) {
      const job = analysis.begin(kind)!;
      flushSync();
      expect(badges(kind)[0]?.closest('a')?.getAttribute('href')).toBe(href);
      expect(target?.querySelectorAll('[data-analysis-badge]')).toHaveLength(1);
      analysis.finish(job, 'cancelled');
      flushSync();
    }
  });

  test('終わったあとは「確認待ち」の印に変わり、その画面に入ると消える', () => {
    render();
    analysis.finish(analysis.begin('order')!, 'done');
    flushSync();
    const mark = wideMarks('order')[0]!;
    expect(mark.getAttribute('data-state')).toBe('done');
    expect(mark.className).toContain('--analysis-done');
    expect(mark.getAttribute('title')).toBe(m.analysis_badge_done());
    expect(mark.querySelector('.sr-only')?.textContent).toBe(m.analysis_badge_done());
    analysis.enter('order');
    flushSync();
    expect(badges('order')).toHaveLength(0);
  });

  test('失敗は赤の印で示し、「!」は出さない', () => {
    render();
    analysis.finish(analysis.begin('classify')!, 'failed');
    flushSync();
    const mark = wideMarks('classify')[0]!;
    expect(mark.getAttribute('data-state')).toBe('failed');
    expect(mark.className).toContain('--analysis-failed');
    expect(mark.textContent).toBe(m.analysis_badge_failed());
    openMenu();
    const text = badges('classify').find((el) => !wideMarks('classify').includes(el))!;
    expect(text.textContent).toBe(m.analysis_badge_failed());
    expect(text.querySelector('[aria-hidden="true"]')?.className).toContain('--analysis-failed');
    expect(mark.querySelector('.sr-only')?.textContent).toBe(m.analysis_badge_failed());
    expect(mark.getAttribute('title')).toBe(m.analysis_badge_failed());
  });

  test('ハンバーガーボタンに印が付き、状態に応じて data-state が変わる', () => {
    render();
    expect(menuMark()).toBeNull();
    const job = analysis.begin('receipt')!;
    flushSync();
    expect(menuMark()?.getAttribute('data-state')).toBe('running');
    analysis.finish(job, 'done');
    flushSync();
    expect(menuMark()?.getAttribute('data-state')).toBe('done');
    analysis.finish(analysis.begin('order')!, 'failed');
    flushSync();
    expect(menuMark()?.getAttribute('data-state')).toBe('failed');
    analysis.enter('order');
    analysis.enter('receipt');
    flushSync();
    expect(menuMark()).toBeNull();
  });

  test('ハンバーガーボタンの説明に項目名と状態が並び、aria-label は変わらない', () => {
    render();
    const button = target?.querySelector('header button[aria-label]');
    expect(button?.getAttribute('aria-label')).toBe(m.nav_menu());
    analysis.finish(analysis.begin('order')!, 'done');
    analysis.begin('receipt');
    flushSync();
    const description = menuDescription();
    expect(description).toContain(`${m.nav_order_import()} ${m.analysis_badge_done()}`);
    expect(description).toContain(`${m.nav_receipt()} ${m.analysis_badge_running()}`);
    expect(description).not.toContain(m.nav_import());
    expect(button?.getAttribute('aria-label')).toBe(m.nav_menu());
  });

  test('状態がなければ説明の要素も aria-describedby も無い', () => {
    render();
    const button = target?.querySelector('header button[aria-label]');
    expect(button?.hasAttribute('aria-describedby')).toBe(false);
    expect(menuDescription()).toBeNull();
    expect(target?.querySelector('#nav-menu-status')).toBeNull();
  });
});
