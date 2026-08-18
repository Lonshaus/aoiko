// 商店が売っていない品目のボタンを出さないこと、購入済みのバッジで文言が変わることを見る。
// どちらも「買えないものを見せない」ための分岐で、間違えると審査で落ちる。

import { describe, expect, test, afterEach, beforeEach } from 'vitest';
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
  support.page = 0;
});

afterEach(() => {
  if (component !== null) {
    unmount(component);
    component = null;
  }
  target?.remove();
  target = null;
});

describe('購入導線', () => {
  test('商店が返さなかった品目のボタンは出さない', () => {
    support.products = [{ kind: 'tip-small', displayPrice: '$0.99' }];
    render();
    flushSync();
    const labels = [...(target?.querySelectorAll('.tier .amount') ?? [])].map((e) => e.textContent);
    expect(labels).toEqual(['$0.99']);
  });

  test('価格は商店が返した文字列をそのまま出す（自前で組み立てない）', () => {
    support.products = [{ kind: 'tip-large', displayPrice: 'NT$60' }];
    render();
    flushSync();
    expect(target?.querySelector('.tier .amount')?.textContent).toBe('NT$60');
  });

  test('支援者バッジを商店が売っていなければ枠ごと出さない', () => {
    support.products = [{ kind: 'tip-small', displayPrice: '¥50' }];
    render();
    flushSync();
    expect(target?.querySelector('.badge-block')).toBeNull();
  });

  test('購入済みならバッジの購入ボタンを出さない', () => {
    support.products = [{ kind: 'supporter-badge', displayPrice: '¥1,000' }];
    support.badgeAt = '2026-03-14';
    render();
    flushSync();
    expect(target?.querySelector('.badge-block .buy')).toBeNull();
    expect(target?.querySelector('.badge-desc')?.textContent).toContain('2026.03.14');
  });
});

// ある環境 は支援者バッジだけを売る。押せない金額ボタンと、永久に 0 個のままの
// スタンプ帳を出さないことを固定する。
describe('消耗型が無い商店（Windows）', () => {
  test('金額ボタンもスタンプ帳も出さない', () => {
    support.products = [{ kind: 'supporter-badge', displayPrice: '¥1,000' }];
    render();
    flushSync();
    expect(target?.querySelector('.tiers')).toBeNull();
    expect(target?.querySelector('.book')).toBeNull();
  });

  test('支援者バッジの枠は出す', () => {
    support.products = [{ kind: 'supporter-badge', displayPrice: '¥1,000' }];
    render();
    flushSync();
    expect(target?.querySelector('.badge-block')).not.toBeNull();
  });
});

describe('スタンプ帳', () => {
  test('空でも 9 枠出す', () => {
    support.products = [{ kind: 'tip-small', displayPrice: '¥50' }];
    render();
    flushSync();
    expect(target?.querySelectorAll('.slot')).toHaveLength(9);
  });

  test('押した日付を点区切りで出す', () => {
    support.products = [{ kind: 'tip-small', displayPrice: '¥50' }];
    support.stamps = [{ id: 's1', tier: 'gold', at: '2026-08-18' }];
    render();
    flushSync();
    expect(target?.querySelector('.stamp .date')?.textContent).toBe('2026.08.18');
  });
});
