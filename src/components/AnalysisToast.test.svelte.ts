import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { router } from '../router.svelte';
import { analysis } from '../stores/analysis.svelte';
import { updateCard } from '../stores/update-card.svelte';
import { m } from '../paraglide/messages';
import AnalysisToast from './AnalysisToast.svelte';

let target: HTMLElement | null = null;
let component: Record<string, unknown> | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  target = document.createElement('div');
  document.body.appendChild(target);
  component = mount(AnalysisToast, { target });
  flushSync();
});

afterEach(() => {
  if (component !== null) {
    unmount(component);
    component = null;
  }
  target?.remove();
  target = null;
  if (analysis.job !== null) {
    analysis.finish(analysis.job, 'cancelled');
  }
  analysis.viewing = null;
  analysis.unseen = {};
  analysis.notices = [];
  router.stay();
  router.goto('/');
  vi.useRealTimers();
});

function toasts(): HTMLElement[] {
  return Array.from(target?.querySelectorAll<HTMLElement>('[data-analysis-toast]') ?? []);
}

describe('AnalysisToast', () => {
  test('通知が無い間も role=status の領域だけは残る', () => {
    const region = target?.querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(toasts()).toHaveLength(0);
  });

  test('別の画面で解析が終わると、画面名つきの完了通知が出る', () => {
    analysis.finish(analysis.begin('receipt')!, 'done');
    flushSync();
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]?.textContent).toContain(m.analysis_toast_done({ name: m.nav_receipt() }));
    expect(target?.querySelector('[role="status"]')?.contains(toasts()[0]!)).toBe(true);
  });

  test('失敗した場合は失敗の文言になる', () => {
    analysis.finish(analysis.begin('order')!, 'failed');
    flushSync();
    expect(toasts()[0]?.textContent).toContain(
      m.analysis_toast_failed({ name: m.nav_order_import() }),
    );
  });

  test('その画面を見ている間は出ない', () => {
    analysis.enter('classify');
    analysis.finish(analysis.begin('classify')!, 'done');
    flushSync();
    expect(toasts()).toHaveLength(0);
  });

  test('押すとその画面へ移動し、通知は消える', () => {
    analysis.finish(analysis.begin('classify')!, 'done');
    flushSync();
    toasts()[0]?.querySelector<HTMLButtonElement>('button')?.click();
    flushSync();
    expect(router.path).toBe('/import');
    expect(toasts()).toHaveLength(0);
  });

  test('閉じるボタンで消せるが、移動はしない', () => {
    analysis.finish(analysis.begin('order')!, 'done');
    flushSync();
    target?.querySelector<HTMLButtonElement>(`button[aria-label="${m.common_close()}"]`)?.click();
    flushSync();
    expect(toasts()).toHaveLength(0);
    expect(router.path).toBe('/');
  });

  test('数秒後に自動で消える', () => {
    analysis.finish(analysis.begin('receipt')!, 'done');
    flushSync();
    expect(toasts()).toHaveLength(1);
    vi.advanceTimersByTime(10_000);
    flushSync();
    expect(toasts()).toHaveLength(0);
  });

  test('複数の通知は重ねて並ぶ', () => {
    analysis.finish(analysis.begin('receipt')!, 'done');
    analysis.finish(analysis.begin('order')!, 'failed');
    flushSync();
    expect(toasts().map((t) => t.dataset['analysisToast'])).toEqual(['receipt', 'order']);
  });
});

describe('更新案内カードとの重なり', () => {
  afterEach(() => {
    updateCard.height = 0;
    updateCard.isShown = null;
  });

  function region(): HTMLElement {
    return target!.querySelector<HTMLElement>('[role="status"]')!;
  }

  test('カードが無いときは下端の余白だけ', () => {
    expect(region().style.paddingBottom).toContain('0px');
    expect(region().style.paddingBottom).not.toContain('58px');
  });

  test('カードが出ている間はカードの高さと間隔のぶん上に積む', () => {
    updateCard.height = 50;
    updateCard.isShown = () => true;
    flushSync();
    expect(region().style.paddingBottom).toContain('58px');
  });
});
