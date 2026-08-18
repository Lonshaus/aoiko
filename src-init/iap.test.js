import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIap, kindFor, productIdsFor, purchaseResultOf } from './iap.js';
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

test('macOS と iOS で品目 ID が分かれている', () => {
  assert.equal(productIdsFor('macos')['tip-small'], 'net.lonshaus.aoiko.mac.tip.small');
  assert.equal(productIdsFor('ios')['tip-small'], 'net.lonshaus.aoiko.ios.tip.small');
  assert.equal(productIdsFor('macos')['supporter-badge'], 'net.lonshaus.aoiko.mac.supporterbadge');
  assert.equal(productIdsFor('ios')['supporter-badge'], 'net.lonshaus.aoiko.ios.supporterbadge');
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

// Windows は支援者バッジだけ。消耗型は商店に品目を作っていないので、間違って
// 売ろうとしないことをここで固定する。
test('Windows はバッジ 1 件だけ', () => {
  assert.deepEqual(Object.keys(productIdsFor('windows')), ['supporter-badge']);
  assert.equal(
    productIdsFor('windows')['supporter-badge'],
    'net.lonshaus.aoiko.win.supporterbadge',
  );
});

test('Windows で消耗型を買おうとしても商店を呼ばない', async () => {
  const { invoke, calls } = fakeInvoke({});
  const iap = createIap(invoke, 'windows');
  assert.equal(await iap.purchaseIap('tip-small'), 'cancelled');
  assert.equal(calls.length, 0);
});

test('Windows の一覧にはバッジしか出ない', async () => {
  const { invoke, calls } = fakeInvoke({
    'plugin:iap|get_products': () => ({
      products: [
        { productId: 'net.lonshaus.aoiko.win.supporterbadge', formattedPrice: '¥1,000' },
        { productId: 'net.lonshaus.aoiko.mac.tip.small', formattedPrice: '¥50' },
      ],
    }),
  });
  const iap = createIap(invoke, 'windows');
  assert.deepEqual(await iap.listIapProducts(), [
    { kind: 'supporter-badge', displayPrice: '¥1,000' },
  ]);
  assert.deepEqual(calls[0].args.payload.productIds, ['net.lonshaus.aoiko.win.supporterbadge']);
});

test('kindFor は自分の商店の ID だけを引く', () => {
  assert.equal(kindFor('macos', 'net.lonshaus.aoiko.mac.tip.large'), 'tip-large');
  assert.equal(kindFor('macos', 'net.lonshaus.aoiko.ios.tip.large'), null);
  assert.equal(kindFor('ios', 'net.lonshaus.aoiko.ios.tip.large'), 'tip-large');
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
        { productId: 'net.lonshaus.aoiko.mac.tip.small', formattedPrice: 'NT$60' },
        { productId: 'net.lonshaus.aoiko.mac.supporterbadge', formattedPrice: '$6.99' },
      ],
    }),
  });
  const iap = createIap(invoke, 'macos');
  assert.deepEqual(await iap.listIapProducts(), [
    { kind: 'tip-small', displayPrice: 'NT$60' },
    { kind: 'supporter-badge', displayPrice: '$6.99' },
  ]);
  assert.deepEqual(calls[0].args.payload.productIds, Object.values(productIdsFor('macos')));
});

test('価格の付いていない品目は出さない', async () => {
  const { invoke } = fakeInvoke({
    'plugin:iap|get_products': () => ({
      products: [
        { productId: 'net.lonshaus.aoiko.mac.tip.small' },
        { productId: 'net.lonshaus.aoiko.mac.tip.large', formattedPrice: '¥150' },
        { productId: 'net.lonshaus.aoiko.mac.unknown', formattedPrice: '¥1' },
      ],
    }),
  });
  const iap = createIap(invoke, 'macos');
  assert.deepEqual(await iap.listIapProducts(), [{ kind: 'tip-large', displayPrice: '¥150' }]);
});

test('確定した消耗型は consume する', async () => {
  const { invoke, calls } = fakeInvoke({
    'plugin:iap|purchase': () => ({ purchaseState: 0, purchaseToken: 'tok-1' }),
    'plugin:iap|consume_purchase': () => undefined,
  });
  const iap = createIap(invoke, 'macos');
  assert.equal(await iap.purchaseIap('tip-medium'), 'purchased');
  assert.equal(calls[0].args.payload.productId, 'net.lonshaus.aoiko.mac.tip.medium');
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
    await iap.purchaseIap('tip-small');
    assert.equal(calls.length, 1);
  }
});

test('知らない kind では商店を呼ばない', async () => {
  const { invoke, calls } = fakeInvoke({});
  const iap = createIap(invoke, 'macos');
  assert.equal(await iap.purchaseIap('tip-huge'), 'cancelled');
  assert.equal(calls.length, 0);
});

test('復元で戻すのは非消耗型だけ', async () => {
  const { invoke } = fakeInvoke({
    'plugin:iap|restore_purchases': () => ({
      purchases: [
        { productId: 'net.lonshaus.aoiko.mac.tip.small' },
        { productId: 'net.lonshaus.aoiko.mac.supporterbadge' },
        { productId: 'net.lonshaus.aoiko.ios.supporterbadge' },
      ],
    }),
  });
  const iap = createIap(invoke, 'macos');
  assert.deepEqual(await iap.restoreIapPurchases(), ['supporter-badge']);
});
