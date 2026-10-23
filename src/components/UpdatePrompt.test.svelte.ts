import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { setLocale } from '../paraglide/runtime';
import { updateCard } from '../stores/update-card.svelte';

type RegisterOptions = {
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisterError?: (error: unknown) => void;
};

const registered: RegisterOptions[] = [];

vi.mock('virtual:pwa-register', () => ({
  registerSW: (options: RegisterOptions) => {
    registered.push(options);
    return async () => {};
  },
}));

const { default: UpdatePrompt } = await import('./UpdatePrompt.svelte');

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(() => {
  setLocale('ja', { reload: false });
  registered.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  if (container !== undefined) {
    container.remove();
    container = undefined;
  }
});

function mountPrompt(): void {
  instance = mount(UpdatePrompt, { target: container! });
  flushSync();
}

function offlineReady(): void {
  registered[0]?.onOfflineReady?.();
  flushSync();
}

function spacer(): Element | null {
  return container!.querySelector('[aria-hidden="true"]');
}

describe('UpdatePrompt', () => {
  test.each([
    ['更新', () => registered[0]?.onNeedRefresh?.()],
    ['オフライン対応', () => registered[0]?.onOfflineReady?.()],
    ['登録失敗', () => registered[0]?.onRegisterError?.(new Error('x'))],
  ])('%sのカードは印刷に出さない', (_name, show) => {
    vi.stubGlobal('navigator', { serviceWorker: { controller: {} } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mountPrompt();
    show();
    flushSync();
    const card = container!.querySelector('.fixed');
    expect(card).not.toBeNull();
    expect(card!.classList.contains('print:hidden')).toBe(true);
  });

  test('カードが無いときは余白を出さない', () => {
    mountPrompt();
    expect(container!.querySelector('.fixed')).toBeNull();
    expect(spacer()).toBeNull();
  });

  test('オフライン対応のカードが出ている間は印刷しない余白をカードの後ろに置く', () => {
    mountPrompt();
    offlineReady();
    const card = container!.querySelector('.fixed');
    expect(card).not.toBeNull();
    const el = spacer();
    expect(el).not.toBeNull();
    expect(el!.classList.contains('print:hidden')).toBe(true);
    expect(card!.nextElementSibling).toBe(el);
  });

  test('カードを閉じると余白も消える', () => {
    mountPrompt();
    offlineReady();
    const close = container!.querySelector('.fixed button');
    expect(close).not.toBeNull();
    (close as HTMLButtonElement).click();
    flushSync();
    expect(container!.querySelector('.fixed')).toBeNull();
    expect(spacer()).toBeNull();
  });
});

describe('UpdatePrompt と解析の通知', () => {
  test('カードの表示状態を通知側へ渡し、外すと渡さなくなる', () => {
    mountPrompt();
    expect(updateCard.isShown?.()).toBe(false);
    offlineReady();
    expect(updateCard.isShown?.()).toBe(true);
    container!.querySelector<HTMLButtonElement>('button')!.click();
    flushSync();
    expect(updateCard.isShown?.()).toBe(false);
    unmount(instance!);
    instance = undefined;
    expect(updateCard.isShown).toBeNull();
  });
});
