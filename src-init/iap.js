// 商店の課金。プラグインの JS API は npm で別配布だが、入口が 4 つしか要らないので
// invoke を直に叩く。aoiko-native も同じ書き方で、新しい npm 依存を増やさない。
//
// 品目 ID は商店ごとに違う。web 側は kind でしか呼ばず、この表だけが実際の ID を知る。
const PRODUCT_IDS = {
  macos: {
    'tip-small': 'net.lonshaus.aoiko.mac.tip.small',
    'tip-medium': 'net.lonshaus.aoiko.mac.tip.medium',
    'tip-large': 'net.lonshaus.aoiko.mac.tip.large',
    'supporter-badge': 'net.lonshaus.aoiko.mac.supporterbadge',
  },
  ios: {
    'tip-small': 'net.lonshaus.aoiko.ios.tip.small',
    'tip-medium': 'net.lonshaus.aoiko.ios.tip.medium',
    'tip-large': 'net.lonshaus.aoiko.ios.tip.large',
    'supporter-badge': 'net.lonshaus.aoiko.ios.supporterbadge',
  },
  // Windows は支援者バッジだけ。消耗型は商店に品目を作っていないので、
  // 表に無い kind は listIapProducts が返さず、スタンプ側の導線ごと出ない。
  windows: {
    'supporter-badge': 'net.lonshaus.aoiko.win.supporterbadge',
  },
};
// StoreKit も Play も、消耗しない品目と分けるためにこの区別を要求する。
// 定期購読は扱わないので inapp 固定。
const PRODUCT_TYPE = 'inapp';
// プラグインが返す purchaseState（0/1/2）。web 側の語彙へ移す。
const PURCHASE_STATE = { 0: 'purchased', 1: 'cancelled', 2: 'pending' };

export function productIdsFor(platform) {
  return PRODUCT_IDS[platform] ?? null;
}

export function kindFor(platform, productId) {
  const table = productIdsFor(platform);
  if (table === null) {
    return null;
  }
  return Object.keys(table).find((k) => table[k] === productId) ?? null;
}

export function purchaseResultOf(purchase) {
  return PURCHASE_STATE[purchase?.purchaseState] ?? 'cancelled';
}

export function createIap(invoke, platform) {
  const ids = productIdsFor(platform);
  // Windows の品目はまだ商店に作っていない。表が無ければ入口ごと生やさず、
  // 支援画面が出ないままにする（能力判定は関数の有無で行われる）。
  if (ids === null) {
    return null;
  }

  async function listIapProducts() {
    const { products } = await invoke('plugin:iap|get_products', {
      payload: { productIds: Object.values(ids), productType: PRODUCT_TYPE },
    });
    return (
      products
        .map((p) => ({ kind: kindFor(platform, p.productId), displayPrice: p.formattedPrice }))
        // 商店が返さなかった品目・審査中で価格が付いていない品目は出さない。
        // 値段の無いボタンを押させない。
        .filter((p) => p.kind !== null && typeof p.displayPrice === 'string')
    );
  }

  async function purchaseIap(kind) {
    const productId = ids[kind];
    if (productId === undefined) {
      return 'cancelled';
    }
    const purchase = await invoke('plugin:iap|purchase', {
      payload: { productId, productType: PRODUCT_TYPE },
    });
    const result = purchaseResultOf(purchase);
    // 消耗型は finish しないと同じ品目を二度買えない。スタンプは何度でも押せる
    // ものなので、確定した時点で必ず消費する。
    if (result === 'purchased' && kind !== 'supporter-badge' && purchase.purchaseToken) {
      await invoke('plugin:iap|consume_purchase', {
        payload: { purchaseToken: purchase.purchaseToken },
      });
    }
    return result;
  }

  async function restoreIapPurchases() {
    const { purchases } = await invoke('plugin:iap|restore_purchases', {
      payload: { productType: PRODUCT_TYPE },
    });
    // 戻すのは非消耗型だけ。消耗型は買い切りの記録が端末に残るもので、
    // 商店から取り戻す対象ではない。
    return purchases
      .map((p) => kindFor(platform, p.productId))
      .filter((kind) => kind === 'supporter-badge');
  }

  return { listIapProducts, purchaseIap, restoreIapPurchases };
}
