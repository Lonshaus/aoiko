// 購入が確定したときだけスタンプが増えること、復元が非消耗型にしか効かないことを見る。
// 商店はここには居ないので、シェルが注入する window.__aoikoNative を差し替えて駆動する。

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { support } from './support.svelte';
import { getSetting } from '../lib/settings';
import { STAMP_COLORS, STAMP_SHAPES } from '../domain/stamps';
import type { IapProductKind, IapPurchaseResult, NativeBridge } from '../lib/native-bridge';

type FakeBridge = NativeBridge & { purchases: IapProductKind[] };

function installBridge(result: IapPurchaseResult, restored: IapProductKind[] = []): FakeBridge {
  const bridge: FakeBridge = {
    purchases: [],
    listIapProducts: () =>
      Promise.resolve([
        { kind: 'tip', displayPrice: '¥150' },
        { kind: 'supporter-badge', displayPrice: '¥500' },
      ]),
    purchaseIap: (kind) => {
      bridge.purchases.push(kind);
      return Promise.resolve(result);
    },
    restoreIapPurchases: () => Promise.resolve(restored),
  };
  (window as unknown as { __aoikoNative?: NativeBridge }).__aoikoNative = bridge;
  return bridge;
}

beforeEach(async () => {
  await db.stamps.clear();
  await db.settings.clear();
  support.stamps = [];
  support.badgeAt = null;
  support.products = [];
  support.productsAsked = false;
  support.page = 0;
});

afterEach(() => {
  delete (window as unknown as { __aoikoNative?: NativeBridge }).__aoikoNative;
});

describe('purchase', () => {
  test('確定した支援はスタンプ 1 個になる', async () => {
    installBridge('purchased');
    await support.purchase('tip');
    expect(support.stamps).toHaveLength(1);
    expect(STAMP_SHAPES).toContain(support.stamps[0]?.shape);
    expect(STAMP_COLORS).toContain(support.stamps[0]?.color);
    expect(await db.stamps.count()).toBe(1);
  });

  test('取り消した支援ではスタンプが増えない', async () => {
    installBridge('cancelled');
    await support.purchase('tip');
    expect(support.stamps).toHaveLength(0);
    expect(await db.stamps.count()).toBe(0);
  });

  test('承認待ちの間もスタンプは増えない', async () => {
    installBridge('pending');
    expect(await support.purchase('tip')).toBe('pending');
    expect(support.stamps).toHaveLength(0);
  });

  test('支援者バッジはスタンプではなく設定に残る', async () => {
    installBridge('purchased');
    await support.purchase('supporter-badge');
    expect(support.stamps).toHaveLength(0);
    expect(support.badgeAt).not.toBeNull();
    expect(await getSetting('supporterBadgeAt')).toBe(support.badgeAt);
  });

  test('橋渡しが購入を持たない環境では商店を呼ばない', async () => {
    expect(await support.purchase('tip')).toBe('unavailable');
    expect(support.stamps).toHaveLength(0);
  });

  test('10 個目で頁が繰り上がり、その頁が開く', async () => {
    installBridge('purchased');
    for (let i = 0; i < 10; i++) {
      await support.purchase('tip');
    }
    expect(support.pageCount).toBe(2);
    expect(support.page).toBe(1);
  });
});

describe('restore', () => {
  test('バッジは戻る', async () => {
    installBridge('purchased', ['supporter-badge']);
    await support.restore();
    expect(support.badgeAt).not.toBeNull();
  });

  test('消耗型が返ってきてもスタンプは増やさない', async () => {
    installBridge('purchased', ['tip']);
    await support.restore();
    expect(support.stamps).toHaveLength(0);
    expect(support.badgeAt).toBeNull();
  });

  test('戻すものが無ければ何も変わらない', async () => {
    installBridge('purchased', []);
    expect(await support.restore()).toEqual([]);
    expect(support.badgeAt).toBeNull();
  });
});

describe('load', () => {
  test('保存済みのスタンプとバッジを読み、最後の頁を開く', async () => {
    installBridge('purchased');
    for (let i = 0; i < 12; i++) {
      await db.stamps.put({
        id: `s${i}`,
        shape: 'bell',
        color: 'blue',
        at: '2026-08-18',
        createdAt: i,
      });
    }
    await support.load();
    expect(support.stamps).toHaveLength(12);
    expect(support.page).toBe(1);
    expect(support.products).toHaveLength(2);
  });
});

// at は日付までしか無く id は UUID v4 なので、この 2 つでは押した順に戻せない。
// 順序が崩れると nextStampFace が見る「直前の何個」が狂い、7 種の輪ごと壊れる。
describe('押した順', () => {
  test('読み込み直しても並びが変わらない', async () => {
    installBridge('purchased');
    for (let i = 0; i < 12; i++) {
      await support.purchase('tip');
    }
    const before = support.stamps.map((s) => `${s.shape}/${s.color}`);

    await support.load();

    expect(support.stamps.map((s) => `${s.shape}/${s.color}`)).toEqual(before);
  });

  test('読み込みを挟んでも 7 種の輪が続く', async () => {
    installBridge('purchased');
    for (let i = 0; i < 5; i++) {
      await support.purchase('tip');
    }
    // 端末を開き直した状況。ここで並びが崩れると、この先の絵柄の選び方が狂う。
    await support.load();
    for (let i = 0; i < 16; i++) {
      await support.purchase('tip');
    }

    const shapes = support.stamps.map((s) => s.shape);
    const colors = support.stamps.map((s) => s.color);
    expect(shapes).toHaveLength(21);
    for (let i = 1; i < shapes.length; i++) {
      expect(shapes[i]).not.toBe(shapes[i - 1]);
      expect(colors[i]).not.toBe(colors[i - 1]);
    }
    for (let at = 0; at + 7 <= shapes.length; at += 7) {
      expect(new Set(shapes.slice(at, at + 7)).size).toBe(7);
      expect(new Set(colors.slice(at, at + 7)).size).toBe(7);
    }
  });

  test('同じミリ秒に続けて押しても順序が付く', async () => {
    installBridge('purchased');
    for (let i = 0; i < 3; i++) {
      await support.purchase('tip');
    }
    const times = support.stamps.map((s) => s.createdAt);
    expect(times[1]).toBeGreaterThan(times[0] ?? 0);
    expect(times[2]).toBeGreaterThan(times[1] ?? 0);
  });
});

describe('品目の取り出し', () => {
  test('片方しか返らないと欠けていると判る', async () => {
    // 実機（TestFlight・ある環境）で、最初の 1 回だけ消耗型しか返らないことがあった。
    // 黙って隠すと利用者は品目が無いのか壊れているのか区別できない。
    let calls = 0;
    (window as unknown as { __aoikoNative?: NativeBridge }).__aoikoNative = {
      listIapProducts: () => {
        calls += 1;
        return Promise.resolve(
          calls === 1
            ? [{ kind: 'tip' as IapProductKind, displayPrice: '¥150' }]
            : [
                { kind: 'tip' as IapProductKind, displayPrice: '¥150' },
                { kind: 'supporter-badge' as IapProductKind, displayPrice: '¥500' },
              ],
        );
      },
    };
    await support.load();
    expect(support.productsMissing).toBe(true);
    expect(support.productFor('supporter-badge')).toBeUndefined();

    await support.loadProducts();
    expect(support.productsMissing).toBe(false);
    expect(support.productFor('supporter-badge')?.displayPrice).toBe('¥500');
  });

  test('問い合わせる前は欠けている扱いにしない', () => {
    expect(support.productsAsked).toBe(false);
    expect(support.productsMissing).toBe(false);
  });
});
