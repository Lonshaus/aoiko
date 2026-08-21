import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createIap,
  kindFor,
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

test('3 つの商店とも品目は 2 つだけ', () => {
  for (const platform of ['macos', 'ios', 'windows']) {
    assert.deepEqual(Object.keys(productIdsFor(platform)), ['tip', 'supporter-badge']);
  }
});

test('商店ごとに品目 ID が分かれている', () => {
  assert.equal(productIdsFor('macos').tip, 'net.lonshaus.aoiko.mac.tip');
  assert.equal(productIdsFor('ios').tip, 'net.lonshaus.aoiko.ios.tip');
  assert.equal(productIdsFor('windows').tip, 'net.lonshaus.aoiko.win.tip');
  assert.equal(productIdsFor('macos')['supporter-badge'], 'net.lonshaus.aoiko.mac.supporterbadge');
  assert.equal(productIdsFor('ios')['supporter-badge'], 'net.lonshaus.aoiko.ios.supporterbadge');
  assert.equal(
    productIdsFor('windows')['supporter-badge'],
    'net.lonshaus.aoiko.win.supporterbadge',
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
  // プラグインは文字列で寄越す。Microsoft Store 側は code が文面に畳み込まれる。
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
      purchases: [
        { productId: 'net.lonshaus.aoiko.mac.tip' },
        { productId: 'net.lonshaus.aoiko.mac.supporterbadge' },
        { productId: 'net.lonshaus.aoiko.ios.supporterbadge' },
      ],
    }),
  });
  const iap = createIap(invoke, 'macos');
  assert.deepEqual(await iap.restoreIapPurchases(), ['supporter-badge']);
});
