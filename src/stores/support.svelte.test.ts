// 購入が確定したときだけスタンプが増えること、復元が非消耗型にしか効かないことを見る。
// 商店はここには居ないので、シェルが注入する window.__aoikoNative を差し替えて駆動する。

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { support } from './support.svelte';
import { getSetting } from '../lib/settings';
import type { IapProductKind, IapPurchaseResult, NativeBridge } from '../lib/native-bridge';

type FakeBridge = NativeBridge & { purchases: IapProductKind[] };

function installBridge(result: IapPurchaseResult, restored: IapProductKind[] = []): FakeBridge {
  const bridge: FakeBridge = {
    purchases: [],
    listIapProducts: () =>
      Promise.resolve([
        { kind: 'tip-small', displayPrice: '¥50' },
        { kind: 'supporter-badge', displayPrice: '¥1,000' },
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
  support.page = 0;
});

afterEach(() => {
  delete (window as unknown as { __aoikoNative?: NativeBridge }).__aoikoNative;
});

describe('purchase', () => {
  test('確定した支援はスタンプ 1 個になる', async () => {
    installBridge('purchased');
    await support.purchase('tip-medium');
    expect(support.stamps).toHaveLength(1);
    expect(support.stamps[0]?.tier).toBe('silver');
    expect(await db.stamps.count()).toBe(1);
  });

  test('取り消した支援ではスタンプが増えない', async () => {
    installBridge('cancelled');
    await support.purchase('tip-medium');
    expect(support.stamps).toHaveLength(0);
    expect(await db.stamps.count()).toBe(0);
  });

  test('承認待ちの間もスタンプは増えない', async () => {
    installBridge('pending');
    expect(await support.purchase('tip-large')).toBe('pending');
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
    expect(await support.purchase('tip-small')).toBe('unavailable');
    expect(support.stamps).toHaveLength(0);
  });

  test('10 個目で頁が繰り上がり、その頁が開く', async () => {
    installBridge('purchased');
    for (let i = 0; i < 10; i++) {
      await support.purchase('tip-small');
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
    installBridge('purchased', ['tip-small', 'tip-large']);
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
      await db.stamps.put({ id: `s${i}`, tier: 'gold', at: '2026-08-18' });
    }
    await support.load();
    expect(support.stamps).toHaveLength(12);
    expect(support.page).toBe(1);
    expect(support.products).toHaveLength(2);
  });
});
