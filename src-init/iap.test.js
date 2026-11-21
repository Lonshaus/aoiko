import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createIap,
  kindFor,
  productIdsFor,
  purchaseResultOf,
  purchaseResultOfError,
} from './iap.js';
// ストアの記録ごとに品目 ID が違い、間違えると「ストアに無い品目」を買わせようとして落ちる。
// 実機でしか気付けないので、対応表と購入時に呼ぶ指令をここで固定する。
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

test('3 つのストアとも品目は支援者バッジだけ', () => {
  for (const platform of ['macos', 'ios', 'windows']) {
    assert.deepEqual(Object.keys(productIdsFor(platform)), ['supporter-badge']);
  }
});

test('macOS と iOS は同じ記録の品目 ID を使い、Windows は別', () => {
  assert.equal(productIdsFor('macos')['supporter-badge'], 'net.lonshaus.aoiko.ios.supporterbadge');
  assert.equal(productIdsFor('ios')['supporter-badge'], 'net.lonshaus.aoiko.ios.supporterbadge');
  assert.equal(
    productIdsFor('windows')['supporter-badge'],
    'net.lonshaus.aoiko.win.supporterbadge',
  );
  assert.deepEqual(productIdsFor('macos'), productIdsFor('ios'));
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

test('kindFor は自分の記録の ID だけを引く', () => {
  assert.equal(kindFor('macos', 'net.lonshaus.aoiko.ios.supporterbadge'), 'supporter-badge');
  assert.equal(kindFor('macos', 'net.lonshaus.aoiko.mac.supporterbadge'), null);
  assert.equal(kindFor('windows', 'net.lonshaus.aoiko.win.supporterbadge'), 'supporter-badge');
});

test('販売を終えた旧品目の ID は品目に対応しない', () => {
  assert.equal(kindFor('macos', 'net.lonshaus.aoiko.ios.tip'), null);
  assert.equal(kindFor('ios', 'net.lonshaus.aoiko.ios.tip'), null);
  assert.equal(kindFor('macos', 'net.lonshaus.aoiko.mac.tip'), null);
  assert.equal(kindFor('windows', 'net.lonshaus.aoiko.win.tip'), null);
});

test('purchaseState は web 側の語彙へ移す', () => {
  assert.equal(purchaseResultOf({ purchaseState: 0 }), 'purchased');
  assert.equal(purchaseResultOf({ purchaseState: 1 }), 'cancelled');
  assert.equal(purchaseResultOf({ purchaseState: 2 }), 'pending');
  // 未知の値を購入済みと解釈しない。取り消し扱いなら、最悪でもバッジが付かないだけ。
  assert.equal(purchaseResultOf({ purchaseState: 99 }), 'cancelled');
  assert.equal(purchaseResultOf(undefined), 'cancelled');
});

test('価格はストアが返した文字列をそのまま渡す', async () => {
  const { invoke, calls } = fakeInvoke({
    'plugin:iap|get_products': () => ({
      products: [{ productId: 'net.lonshaus.aoiko.ios.supporterbadge', formattedPrice: 'NT$35' }],
    }),
  });
  const iap = createIap(invoke, 'macos');
  assert.deepEqual(await iap.listIapProducts(), [
    { kind: 'supporter-badge', displayPrice: 'NT$35' },
  ]);
  assert.deepEqual(calls[0].args.payload.productIds, Object.values(productIdsFor('macos')));
});

test('Windows でも支援者バッジを売る', async () => {
  const { invoke, calls } = fakeInvoke({
    'plugin:iap|get_products': () => ({
      products: [{ productId: 'net.lonshaus.aoiko.win.supporterbadge', formattedPrice: '¥500' }],
    }),
  });
  const iap = createIap(invoke, 'windows');
  assert.deepEqual(await iap.listIapProducts(), [
    { kind: 'supporter-badge', displayPrice: '¥500' },
  ]);
  assert.deepEqual(calls[0].args.payload.productIds, Object.values(productIdsFor('windows')));
});

test('価格の付いていない品目は出さない', async () => {
  const { invoke } = fakeInvoke({
    'plugin:iap|get_products': () => ({
      products: [{ productId: 'net.lonshaus.aoiko.ios.supporterbadge' }],
    }),
  });
  const iap = createIap(invoke, 'macos');
  assert.deepEqual(await iap.listIapProducts(), []);
});

test('表に無い品目は、ストアが返しても出さない', async () => {
  const { invoke } = fakeInvoke({
    'plugin:iap|get_products': () => ({
      products: [
        { productId: 'net.lonshaus.aoiko.ios.tip', formattedPrice: '¥150' },
        { productId: 'net.lonshaus.aoiko.ios.supporterbadge', formattedPrice: '¥500' },
        { productId: 'net.lonshaus.aoiko.ios.unknown', formattedPrice: '¥1' },
      ],
    }),
  });
  const iap = createIap(invoke, 'macos');
  assert.deepEqual(await iap.listIapProducts(), [
    { kind: 'supporter-badge', displayPrice: '¥500' },
  ]);
});

test('支援者バッジの購入が呼ぶ指令は購入だけ', async () => {
  const { invoke, calls } = fakeInvoke({
    'plugin:iap|purchase': () => ({ purchaseState: 0, purchaseToken: 'tok-1' }),
  });
  const iap = createIap(invoke, 'macos');
  assert.equal(await iap.purchaseIap('supporter-badge'), 'purchased');
  assert.equal(calls[0].args.payload.productId, 'net.lonshaus.aoiko.ios.supporterbadge');
  assert.deepEqual(
    calls.map((c) => c.cmd),
    ['plugin:iap|purchase'],
  );
});

test('取り消しと承認待ちでも呼ぶ指令は購入だけ', async () => {
  for (const state of [1, 2]) {
    const { invoke, calls } = fakeInvoke({
      'plugin:iap|purchase': () => ({ purchaseState: state, purchaseToken: 'tok-3' }),
    });
    const iap = createIap(invoke, 'macos');
    await iap.purchaseIap('supporter-badge');
    assert.deepEqual(
      calls.map((c) => c.cmd),
      ['plugin:iap|purchase'],
    );
  }
});
// 取りこぼすと、買わずに閉じただけの操作でエラーバナーが表示される。
test('例外で来る取消・承認待ちも語彙へ移す', () => {
  assert.equal(purchaseResultOfError(new Error('Purchase cancelled by user')), 'cancelled');
  assert.equal(purchaseResultOfError(new Error('Purchase is pending')), 'pending');
  // プラグインは文字列で寄越す。ストア側は code が文面に畳み込まれる。
  assert.equal(purchaseResultOfError('Purchase cancelled by user'), 'cancelled');
  assert.equal(
    purchaseResultOfError('[purchaseNotCompleted] - Purchase was not completed'),
    'cancelled',
  );
  // 本物の失敗は握り潰さない。呼び出し側へ投げ直させる。
  assert.equal(purchaseResultOfError(new Error('Network error during purchase')), null);
  assert.equal(purchaseResultOfError(new Error('Transaction verification failed')), null);
});

test('取消の例外は購入せずに終わる', async () => {
  const { invoke, calls } = fakeInvoke({
    'plugin:iap|purchase': () => {
      throw new Error('Purchase cancelled by user');
    },
  });
  const iap = createIap(invoke, 'macos');
  assert.equal(await iap.purchaseIap('supporter-badge'), 'cancelled');
  assert.equal(calls.length, 1);
});

test('本物の失敗は投げ直す', async () => {
  const { invoke } = fakeInvoke({
    'plugin:iap|purchase': () => {
      throw new Error('Server error during purchase');
    },
  });
  const iap = createIap(invoke, 'macos');
  await assert.rejects(() => iap.purchaseIap('supporter-badge'), /Server error/);
});

test('知らない kind ではストアを呼ばない', async () => {
  const { invoke, calls } = fakeInvoke({});
  const iap = createIap(invoke, 'macos');
  assert.equal(await iap.purchaseIap('badge-small'), 'cancelled');
  assert.equal(calls.length, 0);
});

test('復元で戻すのは表にある品目だけ', async () => {
  const { invoke } = fakeInvoke({
    'plugin:iap|restore_purchases': () => ({
      purchases: [
        { productId: 'net.lonshaus.aoiko.mac.tip' },
        { productId: 'net.lonshaus.aoiko.mac.supporterbadge' },
        { productId: 'net.lonshaus.aoiko.ios.tip' },
        { productId: 'net.lonshaus.aoiko.ios.supporterbadge' },
      ],
    }),
  });
  const iap = createIap(invoke, 'macos');
  assert.deepEqual(await iap.restoreIapPurchases(), ['supporter-badge']);
});

test('旧記録の mac.* は復元対象にならない', async () => {
  const { invoke } = fakeInvoke({
    'plugin:iap|restore_purchases': () => ({
      purchases: [{ productId: 'net.lonshaus.aoiko.mac.supporterbadge' }],
    }),
  });
  const iap = createIap(invoke, 'macos');
  assert.deepEqual(await iap.restoreIapPurchases(), []);
});
