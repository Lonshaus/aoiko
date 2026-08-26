import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createIap,
  isPendingStatus,
  kindFor,
  needsAcknowledge,
  productIdsFor,
  purchaseResultOf,
  purchaseResultOfError,
} from './iap.js';
// 商店ごとに品目 ID が違い、間違えると「商店に無い品目」を買わせようとして落ちる。
// 消耗型を consume し忘れると 2 回目が買えなくなる。どちらも実機でしか気付けないので、
// 対応表と後始末の呼び出しをここで固定する。
function fakeInvoke(handlers) {
  const calls = [];
  const invoke = async (cmd, args) => {
    calls.push({ cmd, args });
    const handler = handlers[cmd];
    if (handler === undefined) {
      throw new Error(`unexpected command: ${cmd}`);
    }
    return handler(args);
  };
  return { invoke, calls };
}

test('4 つの商店とも品目は 2 つだけ', () => {
  for (const platform of ['macos', 'ios', 'windows', 'android']) {
    assert.deepEqual(Object.keys(productIdsFor(platform)), ['tip', 'supporter-badge']);
  }
});

test('商店ごとに品目 ID が分かれている', () => {
  assert.equal(productIdsFor('macos').tip, 'net.lonshaus.aoiko.mac.tip');
  assert.equal(productIdsFor('ios').tip, 'net.lonshaus.aoiko.ios.tip');
  assert.equal(productIdsFor('windows').tip, 'net.lonshaus.aoiko.win.tip');
  assert.equal(productIdsFor('macos')['supporter-badge'], 'net.lonshaus.aoiko.mac.supporterbadge');
  assert.equal(productIdsFor('ios')['supporter-badge'], 'net.lonshaus.aoiko.ios.supporterbadge');
  assert.equal(productIdsFor('android').tip, 'net.lonshaus.aoiko.android.tip');
  assert.equal(
    productIdsFor('windows')['supporter-badge'],
    'net.lonshaus.aoiko.win.supporterbadge',
  );
  assert.equal(
    productIdsFor('android')['supporter-badge'],
    'net.lonshaus.aoiko.android.supporterbadge',
  );
});

test('表に無い環境では入口ごと生えない', () => {
  assert.equal(productIdsFor('linux'), null);
  assert.equal(
    createIap(() => {}, 'linux'),
    null,
  );
  assert.equal(
    createIap(() => {}, undefined),
    null,
  );
});

test('kindFor は自分の商店の ID だけを引く', () => {
  assert.equal(kindFor('macos', 'net.lonshaus.aoiko.mac.tip'), 'tip');
  assert.equal(kindFor('macos', 'net.lonshaus.aoiko.ios.tip'), null);
  assert.equal(kindFor('windows', 'net.lonshaus.aoiko.win.tip'), 'tip');
});

test('purchaseState は web 側の語彙へ移す', () => {
  assert.equal(purchaseResultOf({ purchaseState: 0 }), 'purchased');
  assert.equal(purchaseResultOf({ purchaseState: 1 }), 'cancelled');
  assert.equal(purchaseResultOf({ purchaseState: 2 }), 'pending');
  // 未知の値を購入済みと解釈しない。取り消し扱いなら、最悪でもスタンプが増えないだけ。
  assert.equal(purchaseResultOf({ purchaseState: 99 }), 'cancelled');
  assert.equal(purchaseResultOf(undefined), 'cancelled');
});

test('価格は商店が返した文字列をそのまま渡す', async () => {
  const { invoke, calls } = fakeInvoke({
    'plugin:iap|get_products': () => ({
      products: [
        { productId: 'net.lonshaus.aoiko.mac.tip', formattedPrice: 'NT$35' },
        { productId: 'net.lonshaus.aoiko.mac.supporterbadge', formattedPrice: '$3.99' },
      ],
    }),
  });
  const iap = createIap(invoke, 'macos');
  assert.deepEqual(await iap.listIapProducts(), [
    { kind: 'tip', displayPrice: 'NT$35' },
    { kind: 'supporter-badge', displayPrice: '$3.99' },
  ]);
  assert.deepEqual(calls[0].args.payload.productIds, Object.values(productIdsFor('macos')));
});

test('Windows でも消耗型を売る', async () => {
  const { invoke, calls } = fakeInvoke({
    'plugin:iap|get_products': () => ({
      products: [
        { productId: 'net.lonshaus.aoiko.win.tip', formattedPrice: '¥150' },
        { productId: 'net.lonshaus.aoiko.win.supporterbadge', formattedPrice: '¥500' },
      ],
    }),
  });
  const iap = createIap(invoke, 'windows');
  assert.deepEqual(await iap.listIapProducts(), [
    { kind: 'tip', displayPrice: '¥150' },
    { kind: 'supporter-badge', displayPrice: '¥500' },
  ]);
  assert.deepEqual(calls[0].args.payload.productIds, Object.values(productIdsFor('windows')));
});

test('価格の付いていない品目は出さない', async () => {
  const { invoke } = fakeInvoke({
    'plugin:iap|get_products': () => ({
      products: [
        { productId: 'net.lonshaus.aoiko.mac.tip' },
        { productId: 'net.lonshaus.aoiko.mac.supporterbadge', formattedPrice: '¥500' },
        { productId: 'net.lonshaus.aoiko.mac.unknown', formattedPrice: '¥1' },
      ],
    }),
  });
  const iap = createIap(invoke, 'macos');
  assert.deepEqual(await iap.listIapProducts(), [
    { kind: 'supporter-badge', displayPrice: '¥500' },
  ]);
});

test('確定した消耗型は consume する', async () => {
  const { invoke, calls } = fakeInvoke({
    'plugin:iap|purchase': () => ({ purchaseState: 0, purchaseToken: 'tok-1' }),
    'plugin:iap|consume_purchase': () => undefined,
  });
  const iap = createIap(invoke, 'macos');
  assert.equal(await iap.purchaseIap('tip'), 'purchased');
  assert.equal(calls[0].args.payload.productId, 'net.lonshaus.aoiko.mac.tip');
  assert.equal(calls[1].cmd, 'plugin:iap|consume_purchase');
  assert.equal(calls[1].args.payload.purchaseToken, 'tok-1');
});

test('非消耗型は consume しない（復元できなくなる）', async () => {
  const { invoke, calls } = fakeInvoke({
    'plugin:iap|purchase': () => ({ purchaseState: 0, purchaseToken: 'tok-2' }),
  });
  const iap = createIap(invoke, 'macos');
  assert.equal(await iap.purchaseIap('supporter-badge'), 'purchased');
  assert.equal(calls.length, 1);
});

test('取り消しと承認待ちでは consume しない', async () => {
  for (const state of [1, 2]) {
    const { invoke, calls } = fakeInvoke({
      'plugin:iap|purchase': () => ({ purchaseState: state, purchaseToken: 'tok-3' }),
    });
    const iap = createIap(invoke, 'macos');
    await iap.purchaseIap('tip');
    assert.equal(calls.length, 1);
  }
});

// 取りこぼすと、買わずに閉じただけの操作でエラーバナーが点く。
test('例外で来る取消・承認待ちも語彙へ移す', () => {
  assert.equal(purchaseResultOfError(new Error('Purchase cancelled by user')), 'cancelled');
  assert.equal(purchaseResultOfError(new Error('Purchase is pending')), 'pending');
  // プラグインは文字列で寄越す。商店 側は code が文面に畳み込まれる。
  assert.equal(purchaseResultOfError('Purchase cancelled by user'), 'cancelled');
  assert.equal(
    purchaseResultOfError('[purchaseNotCompleted] - Purchase was not completed'),
    'cancelled',
  );
  // 本物の失敗は握り潰さない。呼び出し側へ投げ直させる。
  assert.equal(purchaseResultOfError(new Error('Network error during purchase')), null);
  assert.equal(purchaseResultOfError(new Error('Transaction verification failed')), null);
});

test('取消の例外は購入せずに終わり、consume も呼ばない', async () => {
  const { invoke, calls } = fakeInvoke({
    'plugin:iap|purchase': () => {
      throw new Error('Purchase cancelled by user');
    },
  });
  const iap = createIap(invoke, 'macos');
  assert.equal(await iap.purchaseIap('tip'), 'cancelled');
  assert.equal(calls.length, 1);
});

test('本物の失敗は投げ直す', async () => {
  const { invoke } = fakeInvoke({
    'plugin:iap|purchase': () => {
      throw new Error('Server error during purchase');
    },
  });
  const iap = createIap(invoke, 'macos');
  await assert.rejects(() => iap.purchaseIap('tip'), /Server error/);
});

test('知らない kind では商店を呼ばない', async () => {
  const { invoke, calls } = fakeInvoke({});
  const iap = createIap(invoke, 'macos');
  assert.equal(await iap.purchaseIap('tip-small'), 'cancelled');
  assert.equal(calls.length, 0);
});

test('復元で戻すのは非消耗型だけ', async () => {
  const { invoke } = fakeInvoke({
    'plugin:iap|restore_purchases': () => ({
      // 3 つの商店とも purchaseState と isAcknowledged を必ず載せて返す。
      purchases: [
        { productId: 'net.lonshaus.aoiko.mac.tip', purchaseState: 0, isAcknowledged: true },
        {
          productId: 'net.lonshaus.aoiko.mac.supporterbadge',
          purchaseState: 0,
          isAcknowledged: true,
        },
        {
          productId: 'net.lonshaus.aoiko.ios.supporterbadge',
          purchaseState: 0,
          isAcknowledged: true,
        },
      ],
    }),
  });
  const iap = createIap(invoke, 'macos');
  assert.deepEqual(await iap.restoreIapPurchases(), ['supporter-badge']);
});

// Play は非消耗型を 3 日以内に acknowledge しないと自動で返金する。実機でも 3 日待たないと
// 気付けないので、呼び出しの有無をここで固定する。
const PLAY_DEPS = { sleep: async () => {}, backFromStore: async () => {} };

test('acknowledge の要否は isAcknowledged で決まる', () => {
  assert.equal(needsAcknowledge({ isAcknowledged: false, purchaseToken: 'tok' }), true);
  assert.equal(needsAcknowledge({ isAcknowledged: true, purchaseToken: 'tok' }), false);
  // 商店 は isAcknowledged を返さない。undefined を「未承認」と読むと毎回呼んでしまう。
  assert.equal(needsAcknowledge({ purchaseToken: 'tok' }), false);
  assert.equal(needsAcknowledge({ isAcknowledged: false }), false);
});

test('Play の非消耗型は acknowledge する', async () => {
  const { invoke, calls } = fakeInvoke({
    'plugin:iap|purchase': () => ({
      purchaseState: 0,
      purchaseToken: 'tok-ack',
      isAcknowledged: false,
    }),
    'plugin:iap|acknowledge_purchase': () => undefined,
  });
  const iap = createIap(invoke, 'android', PLAY_DEPS);
  assert.equal(await iap.purchaseIap('supporter-badge'), 'purchased');
  assert.equal(calls[1].cmd, 'plugin:iap|acknowledge_purchase');
  assert.equal(calls[1].args.payload.purchaseToken, 'tok-ack');
});

test('承認済みなら acknowledge を呼ばない', async () => {
  const { invoke, calls } = fakeInvoke({
    'plugin:iap|purchase': () => ({
      purchaseState: 0,
      purchaseToken: 'tok-done',
      isAcknowledged: true,
    }),
  });
  const iap = createIap(invoke, 'android', PLAY_DEPS);
  assert.equal(await iap.purchaseIap('supporter-badge'), 'purchased');
  assert.equal(calls.length, 1);
});

// 商店 と 商店 に acknowledge は無く、プラグインは no-op か拒否を返す。
test('Play 以外では acknowledge を呼ばない', async () => {
  for (const platform of ['macos', 'ios', 'windows']) {
    const { invoke, calls } = fakeInvoke({
      'plugin:iap|purchase': () => ({
        purchaseState: 0,
        purchaseToken: 'tok',
        isAcknowledged: false,
      }),
    });
    const iap = createIap(invoke, platform);
    await iap.purchaseIap('supporter-badge');
    assert.equal(calls.length, 1, platform);
  }
});

test('Play の消耗型は consume だけで acknowledge を重ねない', async () => {
  const { invoke, calls } = fakeInvoke({
    'plugin:iap|purchase': () => ({
      purchaseState: 0,
      purchaseToken: 'tok-tip',
      isAcknowledged: false,
    }),
    'plugin:iap|consume_purchase': () => undefined,
  });
  const iap = createIap(invoke, 'android', PLAY_DEPS);
  assert.equal(await iap.purchaseIap('tip'), 'purchased');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].cmd, 'plugin:iap|consume_purchase');
});

// プラグインの handlePurchase は PURCHASED のときしか応じない。保留のままだと
// purchase の約束が解決も拒否もされず、支援画面が押したまま戻らなくなる。
test('保留は purchase が決着しなくても pending になる', async () => {
  const { invoke } = fakeInvoke({
    'plugin:iap|purchase': () => new Promise(() => {}),
    'plugin:iap|get_product_status': () => ({ isOwned: true, purchaseState: 2 }),
  });
  const iap = createIap(invoke, 'android', PLAY_DEPS);
  assert.equal(await iap.purchaseIap('tip'), 'pending');
});

test('保留が見えないまま上限に達したら理由を付けて投げる', async () => {
  const { invoke } = fakeInvoke({
    'plugin:iap|purchase': () => new Promise(() => {}),
    'plugin:iap|get_product_status': () => {
      throw new Error('Billing client not ready');
    },
  });
  const iap = createIap(invoke, 'android', PLAY_DEPS);
  await assert.rejects(
    () => iap.purchaseIap('tip'),
    /確認できませんでした.*Billing client not ready/,
  );
});

test('保留の見張りは購入が決着したら商店を叩き続けない', async () => {
  const { invoke, calls } = fakeInvoke({
    'plugin:iap|purchase': () => ({ purchaseState: 0, purchaseToken: 'tok', isAcknowledged: true }),
    'plugin:iap|get_product_status': () => ({ isOwned: false }),
  });
  const iap = createIap(invoke, 'android', PLAY_DEPS);
  assert.equal(await iap.purchaseIap('supporter-badge'), 'purchased');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(
    calls.filter((c) => c.cmd === 'plugin:iap|get_product_status').length <= 1,
    '決着後も問い合わせ続けている',
  );
});

test('isPendingStatus は保有していない品目を保留と読まない', () => {
  assert.equal(isPendingStatus({ isOwned: true, purchaseState: 2 }), true);
  assert.equal(isPendingStatus({ isOwned: true, purchaseState: 0 }), false);
  assert.equal(isPendingStatus({ isOwned: false, purchaseState: 2 }), false);
  assert.equal(isPendingStatus(undefined), false);
});

// 支払い前にバッジが点くと、返金された後も点いたままになる。
test('復元は保留の購入を持ち物に数えない', async () => {
  const { invoke } = fakeInvoke({
    'plugin:iap|restore_purchases': () => ({
      purchases: [{ productId: 'net.lonshaus.aoiko.android.supporterbadge', purchaseState: 2 }],
    }),
  });
  const iap = createIap(invoke, 'android', PLAY_DEPS);
  assert.deepEqual(await iap.restoreIapPurchases(), []);
});

// 購入の途中でアプリが落ちると購入直後の acknowledge が飛ぶ。ここが最後の受け皿。
test('復元で未承認の非消耗型を見つけたら acknowledge する', async () => {
  const { invoke, calls } = fakeInvoke({
    'plugin:iap|restore_purchases': () => ({
      purchases: [
        {
          productId: 'net.lonshaus.aoiko.android.supporterbadge',
          purchaseState: 0,
          purchaseToken: 'tok-late',
          isAcknowledged: false,
        },
      ],
    }),
    'plugin:iap|acknowledge_purchase': () => undefined,
  });
  const iap = createIap(invoke, 'android', PLAY_DEPS);
  assert.deepEqual(await iap.restoreIapPurchases(), ['supporter-badge']);
  assert.equal(calls[1].cmd, 'plugin:iap|acknowledge_purchase');
  assert.equal(calls[1].args.payload.purchaseToken, 'tok-late');
});
