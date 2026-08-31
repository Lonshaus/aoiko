// ハンバーガーメニューを外側タップ・Escape で閉じられること。SupportDialog と違い
// <dialog> ではなく通常要素なので、暗幕・キー操作を自前で用意している。

import { describe, expect, test, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// UpdatePrompt.svelte は VitePWA の virtual module を読むが、vitest.config.ts には
// その plugin を積んでいないため解決できない。この試験の対象外なのでまるごと差し替える。
vi.mock('./components/UpdatePrompt.svelte', () => ({ default: () => {} }));

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
    expect(target?.querySelector('header nav.md\\:hidden')).not.toBeNull();
    const dismiss = target?.querySelector<HTMLButtonElement>('button.fixed.inset-0');
    dismiss?.click();
    flushSync();
    expect(target?.querySelector('header nav.md\\:hidden')).toBeNull();
  });

  test('Escape を押すと閉じる', () => {
    render();
    openMenu();
    expect(target?.querySelector('header nav.md\\:hidden')).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushSync();
    expect(target?.querySelector('header nav.md\\:hidden')).toBeNull();
  });
});
