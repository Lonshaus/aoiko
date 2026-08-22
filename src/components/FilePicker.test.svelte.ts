// ボタンの見た目を自前にしても、選ばせる仕組みは input 側のまま——という前提を固定する。
// input を消すと、キーボード操作も読み上げも ある環境 の選択シートも一緒に消える。

import { describe, expect, test, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import FilePicker from './FilePicker.svelte';

let target: HTMLElement | null = null;
let component: Record<string, unknown> | null = null;

function render(props: Record<string, unknown> = {}): HTMLInputElement {
  target = document.createElement('div');
  document.body.appendChild(target);
  component = mount(FilePicker, {
    target,
    props: { onchange: () => {}, ...props },
  });
  flushSync();
  const input = target.querySelector('input');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('input が無い');
  }
  return input;
}

afterEach(() => {
  if (component !== null) {
    unmount(component);
    component = null;
  }
  target?.remove();
  target = null;
});

describe('FilePicker', () => {
  test('本物の input type=file を残す', () => {
    expect(render().type).toBe('file');
  });

  test('input は label の中にある（クリックで選択が開く）', () => {
    const input = render();
    expect(input.closest('label')).not.toBeNull();
  });

  // display:none だと一部のブラウザでキーボードから到達できなくなる。
  // sr-only は視覚的に隠すだけで、focus は残る。
  test('隠し方は display:none ではない', () => {
    const input = render();
    expect(input.classList.contains('sr-only')).toBe(true);
    expect(input.style.display).not.toBe('none');
  });

  test('ボタンの文字は app 側から出す', () => {
    render();
    const span = target?.querySelector('label span');
    expect(span?.textContent?.trim()).not.toBe('');
  });

  test('accept をそのまま渡す', () => {
    expect(render({ accept: '.csv,text/csv' }).accept).toBe('.csv,text/csv');
  });

  test('accept を渡さなければ属性を付けない', () => {
    expect(render().hasAttribute('accept')).toBe(false);
  });

  test('選択されたら onchange が呼ばれる', () => {
    let calls = 0;
    const input = render({ onchange: () => (calls += 1) });
    // Svelte 5 は change を委譲する（監視は根に付く）。実際の change は仕様上バブルするので、
    // bubbles を付けないと根まで届かず、部品ではなくこの試験の作り方が間違いになる。
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(calls).toBe(1);
  });

  test('onclick を渡せる（行の開閉と重なる場所で伝播を止める）', () => {
    let stopped = false;
    const input = render({ onclick: () => (stopped = true) });
    input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(stopped).toBe(true);
  });
});
