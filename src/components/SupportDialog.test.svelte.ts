// 商店が売っていない品目のボタンを出さないこと、購入済みのバッジで文言が変わることを見る。
// どちらも「買えないものを見せない」ための分岐で、間違えると審査で落ちる。

import { describe, expect, test, afterEach, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SupportDialog from './SupportDialog.svelte';
import { support } from '../stores/support.svelte';
import { db } from '../db/db';

let target: HTMLElement | null = null;
let component: Record<string, unknown> | null = null;

function render(): void {
  target = document.createElement('div');
  document.body.appendChild(target);
  component = mount(SupportDialog, { target, props: { open: false, onclose: () => {} } });
  flushSync();
}

beforeEach(async () => {
  await db.stamps.clear();
  support.stamps = [];
  support.badgeAt = null;
  support.products = [];
  support.productsAsked = false;
  support.page = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (component !== null) {
    unmount(component);
    component = null;
  }
  target?.remove();
  target = null;
});

describe('購入導線', () => {
  test('価格は商店が返した文字列をそのまま出す（自前で組み立てない）', () => {
    support.products = [{ kind: 'tip', displayPrice: 'NT$35' }];
    render();
    flushSync();
    expect(target?.querySelector('.tier .amount')?.textContent).toBe('NT$35');
  });

  test('消耗型を商店が売っていなければ金額ボタンもスタンプ帳も出さない', () => {
    support.products = [{ kind: 'supporter-badge', displayPrice: '¥500' }];
    render();
    flushSync();
    expect(target?.querySelector('.tiers')).toBeNull();
    expect(target?.querySelector('.book')).toBeNull();
    expect(target?.querySelector('.badge-block')).not.toBeNull();
  });

  test('支援者バッジを商店が売っていなければ枠ごと出さない', () => {
    support.products = [{ kind: 'tip', displayPrice: '¥150' }];
    render();
    flushSync();
    expect(target?.querySelector('.badge-block')).toBeNull();
  });

  test('購入済みならバッジの購入ボタンを出さない', () => {
    support.products = [{ kind: 'supporter-badge', displayPrice: '¥500' }];
    support.badgeAt = '2026-03-14';
    render();
    flushSync();
    expect(target?.querySelector('.badge-block .buy')).toBeNull();
    expect(target?.querySelector('.badge-desc')?.textContent).toContain('2026.03.14');
  });
});

describe('スタンプ帳', () => {
  test('空でも 9 枠出す', () => {
    support.products = [{ kind: 'tip', displayPrice: '¥150' }];
    render();
    flushSync();
    expect(target?.querySelectorAll('.slot')).toHaveLength(9);
  });

  test('押した日付を点区切りで出す', () => {
    support.products = [{ kind: 'tip', displayPrice: '¥150' }];
    support.stamps = [{ id: 's1', shape: 'fish', color: 'blue', at: '2026-08-18', createdAt: 1 }];
    render();
    flushSync();
    expect(target?.querySelector('.stamp .date')?.textContent).toBe('2026.08.18');
  });

  // 絵柄は保存されたものを描く。ここが位置や乱数で決まっていると、同じスタンプの
  // 見た目が再読み込みのたびに変わる。
  test('保存された絵柄と色をそのまま描く', () => {
    support.products = [{ kind: 'tip', displayPrice: '¥150' }];
    support.stamps = [
      { id: 's1', shape: 'butterfly', color: 'violet', at: '2026-08-18', createdAt: 1 },
    ];
    render();
    flushSync();
    expect(target?.querySelector('.stamp')?.classList.contains('violet')).toBe(true);
    expect(target?.querySelector('.stamp .toy use')?.getAttribute('href')).toBe('#stamp-butterfly');
  });

  test('絵柄ごとに違う図形を引く', () => {
    support.products = [{ kind: 'tip', displayPrice: '¥150' }];
    support.stamps = [
      { id: 's1', shape: 'yarn', color: 'red', at: '2026-08-18', createdAt: 1 },
      { id: 's2', shape: 'bell', color: 'green', at: '2026-08-18', createdAt: 2 },
    ];
    render();
    flushSync();
    const refs = [...(target?.querySelectorAll('.stamp .toy use') ?? [])].map((e) =>
      e.getAttribute('href'),
    );
    expect(refs).toEqual(['#stamp-yarn', '#stamp-bell']);
  });

  // 7 種すべてに図形が要る。1 つでも欠けると、その絵柄のスタンプだけ空白で押される。
  test('7 種すべての図形が定義されている', () => {
    support.products = [{ kind: 'tip', displayPrice: '¥150' }];
    render();
    flushSync();
    for (const shape of ['yarn', 'mouse', 'bell', 'feather', 'fish', 'butterfly', 'teaser']) {
      expect(target?.querySelector(`#stamp-${shape}`)).not.toBeNull();
    }
  });
});

// 商店が片方しか返さないことが実機で起きた（#491）。黙って隠すと、審査員には
// 宣言した品目が画面に無い状態が見える。
describe('品目が揃わないとき', () => {
  function missing(): HTMLElement | null {
    return target?.querySelector('.missing') ?? null;
  }

  test('商店に問い合わせる前は、まだ何も言わない', () => {
    render();
    expect(missing()).toBeNull();
  });

  test('片方しか返らなければ、隠さずに取れなかったことを出す', () => {
    support.products = [{ kind: 'tip', displayPrice: '¥150' }];
    support.productsAsked = true;
    render();
    expect(missing()).not.toBeNull();
    expect(missing()?.querySelector('button')).not.toBeNull();
  });

  test('1 つも返らなくても同じく出す', () => {
    support.productsAsked = true;
    render();
    expect(missing()).not.toBeNull();
  });

  test('揃っていれば出さない', () => {
    support.products = [
      { kind: 'tip', displayPrice: '¥150' },
      { kind: 'supporter-badge', displayPrice: '¥500' },
    ];
    support.productsAsked = true;
    render();
    expect(missing()).toBeNull();
  });

  // 実機で起きたのはこの順序：最初に開くと片方だけ、開き直すと両方。
  test('押すと商店へ問い合わせ直し、揃えば表示が消える', async () => {
    const both = [
      { kind: 'tip' as const, displayPrice: '¥150' },
      { kind: 'supporter-badge' as const, displayPrice: '¥500' },
    ];
    let asked = 0;
    const listIapProducts = vi.fn(async () => {
      asked += 1;
      return asked === 1 ? [both[0]!] : both;
    });
    vi.stubGlobal('window', Object.assign(window, { __aoikoNative: { listIapProducts } }));
    render();
    // 1 回目の返りは片方だけ。まず出ることを確かめてから押す。
    await vi.waitFor(() => {
      flushSync();
      expect(missing()).not.toBeNull();
    });
    missing()?.querySelector('button')?.click();
    await vi.waitFor(() => {
      flushSync();
      expect(missing()).toBeNull();
    });
    expect(asked).toBe(2);
  });
});
