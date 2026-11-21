// 購入が確定したときだけバッジが付くこと、復元でバッジが戻ること、過去に押したスタンプが
// 読み込まれることを見る。ストアはここには居ないので、シェルが注入する
// window.__aoikoNative を差し替えて駆動する。

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { support } from './support.svelte';
import { getSetting } from '../lib/settings';
import type { IapProductKind, IapPurchaseResult, NativeBridge } from '../lib/native-bridge';

type FakeBridge = NativeBridge & { purchases: IapProductKind[] };

function installBridge(result: IapPurchaseResult, restored: IapProductKind[] = []): FakeBridge {
  const bridge: FakeBridge = {
    purchases: [],
    listIapProducts: () => Promise.resolve([{ kind: 'supporter-badge', displayPrice: '¥500' }]),
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
  test('確定した購入は設定にバッジの購入日を残す', async () => {
    installBridge('purchased');
    await support.purchase('supporter-badge');
    expect(support.badgeAt).not.toBeNull();
    expect(await getSetting('supporterBadgeAt')).toBe(support.badgeAt);
  });

  test('バッジの購入はスタンプを増やさない', async () => {
    installBridge('purchased');
    await support.purchase('supporter-badge');
    expect(support.stamps).toHaveLength(0);
    expect(await db.stamps.count()).toBe(0);
  });

  test('取り消した購入ではバッジが付かない', async () => {
    installBridge('cancelled');
    await support.purchase('supporter-badge');
    expect(support.badgeAt).toBeNull();
    expect(await getSetting('supporterBadgeAt')).toBeUndefined();
  });

  test('承認待ちの間もバッジは付かない', async () => {
    installBridge('pending');
    expect(await support.purchase('supporter-badge')).toBe('pending');
    expect(support.badgeAt).toBeNull();
  });

  test('橋渡しが購入を持たない環境ではストアを呼ばない', async () => {
    expect(await support.purchase('supporter-badge')).toBe('unavailable');
    expect(support.badgeAt).toBeNull();
  });
});

describe('restore', () => {
  test('バッジは戻る', async () => {
    installBridge('purchased', ['supporter-badge']);
    await support.restore();
    expect(support.badgeAt).not.toBeNull();
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
    expect(support.hasStamps).toBe(true);
    expect(support.page).toBe(1);
    expect(support.products).toHaveLength(1);
  });

  test('スタンプが無ければ hasStamps は false', async () => {
    installBridge('purchased');
    await support.load();
    expect(support.hasStamps).toBe(false);
  });
  // at は日付までしか無く id は UUID v4 なので、この 2 つでは押した順に戻せない。
  test('スタンプは押した順に読み込む', async () => {
    installBridge('purchased');
    for (const [id, createdAt] of [
      ['b', 2],
      ['c', 3],
      ['a', 1],
    ] as const) {
      await db.stamps.put({ id, shape: 'bell', color: 'blue', at: '2026-08-18', createdAt });
    }
    await support.load();
    expect(support.stamps.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('品目の取り出し', () => {
  test('ストアが支援者バッジだけ返したときは欠けていると言わない', async () => {
    installBridge('purchased');
    await support.load();
    expect(support.productsMissing).toBe(false);
    expect(support.productFor('supporter-badge')?.displayPrice).toBe('¥500');
  });

  test('何も返らなければ欠けていると判り、取り直すと戻る', async () => {
    // 実機（TestFlight・ある環境）で、最初の 1 回だけ品目が返らないことがあった。
    // 黙って隠すと利用者は品目が無いのか壊れているのか区別できない。
    let calls = 0;
    (window as unknown as { __aoikoNative?: NativeBridge }).__aoikoNative = {
      listIapProducts: () => {
        calls += 1;
        return Promise.resolve(
          calls === 1 ? [] : [{ kind: 'supporter-badge' as IapProductKind, displayPrice: '¥500' }],
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
