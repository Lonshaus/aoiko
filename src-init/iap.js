// ストアの課金。プラグインの JS API は npm で別配布だが、入口が 3 つしか要らないので
// invoke を直に叩く。aoiko-native も同じ書き方で、新しい npm 依存を増やさない。
//
// 品目 ID はストアの記録ごとに違う。web 側は kind でしか呼ばず、この表だけが実際の ID を知る。
const PRODUCT_IDS = {
  // macOS 版は iOS 版と同じ記録で配るので、品目も iOS の ID を使う。
  macos: {
    'supporter-badge': 'net.lonshaus.aoiko.ios.supporterbadge',
  },
  ios: {
    'supporter-badge': 'net.lonshaus.aoiko.ios.supporterbadge',
  },
  windows: {
    'supporter-badge': 'net.lonshaus.aoiko.win.supporterbadge',
  },
};
// どのストアも品目の種類の指定を要求する。定期購読は扱わないので inapp 固定。
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
// プラグインは取消と保留を戻り値ではなく例外で伝える。放置すると未捕捉の例外として
// エラーバナーが表示される。
export function purchaseResultOfError(error) {
  // プラグインは Error を文字列へ直列化して寄越すので、判るのは文面だけ。
  // ストアごとに文言が違う（「cancelled by user」「[purchaseNotCompleted] - ...」など）。
  const message = String(error?.message ?? error ?? '').toLowerCase();
  if (message.includes('cancel') || message.includes('notcompleted')) {
    return 'cancelled';
  }
  if (message.includes('pending')) {
    return 'pending';
  }
  return null;
}

export function createIap(invoke, platform) {
  const ids = productIdsFor(platform);
  // 品目をまだストアに作っていない環境がある。表が無ければ入口ごと生やさず、
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
        // ストアが返さなかった品目・審査中で価格が付いていない品目は出さない。
        // 値段の無いボタンを押させない。
        .filter((p) => p.kind !== null && typeof p.displayPrice === 'string')
    );
  }

  async function purchaseIap(kind) {
    const productId = ids[kind];
    if (productId === undefined) {
      return 'cancelled';
    }
    let purchase;
    try {
      purchase = await invoke('plugin:iap|purchase', {
        payload: { productId, productType: PRODUCT_TYPE },
      });
    } catch (error) {
      const fromError = purchaseResultOfError(error);
      if (fromError === null) {
        throw error;
      }
      return fromError;
    }
    return purchaseResultOf(purchase);
  }

  async function restoreIapPurchases() {
    const { purchases } = await invoke('plugin:iap|restore_purchases', {
      payload: { productType: PRODUCT_TYPE },
    });
    // 表に無い品目（販売を終えた旧品目）は戻さない。
    return purchases.map((p) => kindFor(platform, p.productId)).filter((kind) => kind !== null);
  }

  return { listIapProducts, purchaseIap, restoreIapPurchases };
}
