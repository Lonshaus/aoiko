// ストアが売っていない品目のボタンを出さないこと、購入済みのバッジで文言が変わること、
// スタンプ帳が、押した記録のあるときだけ出ることを見る。
// 「買えないものを見せない」ための分岐で、間違えると審査で落ちる。

import { describe, expect, test, afterEach, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SupportDialog from './SupportDialog.svelte';
import { support } from '../stores/support.svelte';
import { db } from '../db/db';

let target: HTMLElement | null = null;
let component: Record<string, unknown> | null = null;

function render(onclose: () => void = () => {}): void {
  target = document.createElement('div');
  document.body.appendChild(target);
  component = mount(SupportDialog, { target, props: { open: false, onclose } });
  flushSync();
}
// jsdom の <dialog> はレイアウトを持たず矩形が全て 0 になるので、判定に使う箱を差し替える。
function clickDialog(at: { x: number; y: number }): void {
  const dialog = target?.querySelector('dialog');
  if (dialog === null || dialog === undefined) {
    throw new Error('dialog が無い');
  }
  dialog.getBoundingClientRect = () =>
    ({ left: 100, right: 300, top: 100, bottom: 300 }) as DOMRect;
  dialog.dispatchEvent(
    new MouseEvent('click', { bubbles: true, detail: 1, clientX: at.x, clientY: at.y }),
  );
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
  test('価格はストアが返した文字列をそのまま出す（自前で組み立てない）', () => {
    support.products = [{ kind: 'supporter-badge', displayPrice: 'NT$35' }];
    render();
    flushSync();
    expect(target?.querySelector('.badge-block .buy')?.textContent?.trim()).toBe('NT$35');
  });

  test('支援者バッジをストアが売っていなければ枠ごと出さない', () => {
    support.products = [];
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

  test('スタンプが無いとき、購入ボタンはバッジの 1 つだけでスタンプのボタンは無い', () => {
    support.products = [{ kind: 'supporter-badge', displayPrice: '¥500' }];
    render();
    flushSync();
    expect(target?.querySelectorAll('button.buy')).toHaveLength(1);
    expect(target?.querySelector('.tiers')).toBeNull();
    expect(target?.querySelector('.tier')).toBeNull();
  });

  test('スタンプがあるときも、スタンプの購入ボタンは出さない', () => {
    support.products = [{ kind: 'supporter-badge', displayPrice: '¥500' }];
    support.stamps = [{ id: 's1', shape: 'fish', color: 'blue', at: '2026-08-18', createdAt: 1 }];
    render();
    flushSync();
    expect(target?.querySelector('.book')).not.toBeNull();
    expect(target?.querySelectorAll('button.buy')).toHaveLength(1);
    expect(target?.querySelector('.tiers')).toBeNull();
    expect(target?.querySelector('.tier')).toBeNull();
  });
});

describe('スタンプ帳', () => {
  test('スタンプが無ければスタンプ帳を出さない', () => {
    support.products = [{ kind: 'supporter-badge', displayPrice: '¥500' }];
    render();
    flushSync();
    expect(target?.querySelector('.book')).toBeNull();
    expect(target?.querySelectorAll('.slot')).toHaveLength(0);
  });

  test('保存済みのスタンプがあれば、読み込み後に個数・頁数・日付つきで出す', async () => {
    for (let i = 0; i < 3; i++) {
      await db.stamps.put({
        id: `s${i}`,
        shape: 'bell',
        color: 'blue',
        at: `2026-08-1${i}`,
        createdAt: i,
      });
    }
    render();
    await vi.waitFor(() => {
      flushSync();
      expect(target?.querySelector('.book')).not.toBeNull();
    });
    expect(target?.querySelector('.tally')?.textContent).toContain('3');
    expect(target?.querySelectorAll('.stamp')).toHaveLength(3);
    expect(target?.querySelector('.pager span')?.textContent).toContain('1 / 1');
    expect([...(target?.querySelectorAll('.stamp .date') ?? [])].map((e) => e.textContent)).toEqual(
      ['2026.08.10', '2026.08.11', '2026.08.12'],
    );
  });

  test('10 個を超えると頁が分かれ、最後の頁が開く', async () => {
    for (let i = 0; i < 10; i++) {
      await db.stamps.put({
        id: `s${i}`,
        shape: 'bell',
        color: 'blue',
        at: '2026-08-18',
        createdAt: i,
      });
    }
    render();
    await vi.waitFor(() => {
      flushSync();
      expect(target?.querySelector('.book')).not.toBeNull();
    });
    expect(target?.querySelector('.pager span')?.textContent).toContain('2 / 2');
    expect(target?.querySelectorAll('.stamp')).toHaveLength(1);
  });

  test('スタンプがあれば 9 枠出す', () => {
    support.stamps = [{ id: 's1', shape: 'fish', color: 'blue', at: '2026-08-18', createdAt: 1 }];
    render();
    flushSync();
    expect(target?.querySelectorAll('.slot')).toHaveLength(9);
  });

  test('押した日付を点区切りで出す', () => {
    support.stamps = [{ id: 's1', shape: 'fish', color: 'blue', at: '2026-08-18', createdAt: 1 }];
    render();
    flushSync();
    expect(target?.querySelector('.stamp .date')?.textContent).toBe('2026.08.18');
  });
  // 絵柄は保存されたものを描く。ここが位置や乱数で決まっていると、同じスタンプの
  // 見た目が再読み込みのたびに変わる。
  test('保存された絵柄と色をそのまま描く', () => {
    support.stamps = [
      { id: 's1', shape: 'butterfly', color: 'violet', at: '2026-08-18', createdAt: 1 },
    ];
    render();
    flushSync();
    expect(target?.querySelector('.stamp')?.classList.contains('violet')).toBe(true);
    expect(target?.querySelector('.stamp .toy use')?.getAttribute('href')).toBe('#stamp-butterfly');
  });

  test('絵柄ごとに違う図形を引く', () => {
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
    render();
    flushSync();
    for (const shape of ['yarn', 'mouse', 'bell', 'feather', 'fish', 'butterfly', 'teaser']) {
      expect(target?.querySelector(`#stamp-${shape}`)).not.toBeNull();
    }
  });
});

describe('閉じる', () => {
  test('暗幕を押したら閉じる', () => {
    let closed = 0;
    render(() => {
      closed += 1;
    });
    clickDialog({ x: 10, y: 10 });
    expect(closed).toBe(1);
  });

  test('中身を押しても閉じない（padding も dialog が target になる）', () => {
    let closed = 0;
    render(() => {
      closed += 1;
    });
    clickDialog({ x: 200, y: 200 });
    expect(closed).toBe(0);
  });

  test('キーボード由来の click は座標を持たないので閉じない', () => {
    let closed = 0;
    render(() => {
      closed += 1;
    });
    const dialog = target?.querySelector('dialog');
    dialog?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    flushSync();
    expect(closed).toBe(0);
  });
});
// ストアが品目を返さないことが実機で起きた（#491）。黙って隠すと、審査員には
// 宣言した品目が画面に無い状態が見える。
describe('品目が揃わないとき', () => {
  function missing(): HTMLElement | null {
    return target?.querySelector('.missing') ?? null;
  }

  test('ストアに問い合わせる前は、まだ何も言わない', () => {
    render();
    expect(missing()).toBeNull();
  });

  test('何も返らなければ、隠さずに取れなかったことを出す', () => {
    support.productsAsked = true;
    render();
    expect(missing()).not.toBeNull();
    expect(missing()?.querySelector('button')).not.toBeNull();
  });

  test('支援者バッジだけが返れば揃っているので出さない', () => {
    support.products = [{ kind: 'supporter-badge', displayPrice: '¥500' }];
    support.productsAsked = true;
    render();
    expect(missing()).toBeNull();
  });
  // 実機で起きたのはこの順序：最初に開くと空、開き直すと返る。
  test('押すとストアへ問い合わせ直し、返れば表示が消える', async () => {
    const badge = { kind: 'supporter-badge' as const, displayPrice: '¥500' };
    let asked = 0;
    const listIapProducts = vi.fn(async () => {
      asked += 1;
      return asked === 1 ? [] : [badge];
    });
    vi.stubGlobal('window', Object.assign(window, { __aoikoNative: { listIapProducts } }));
    render();
    // 1 回目の返りは空。まず出ることを確かめてから押す。
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
