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
