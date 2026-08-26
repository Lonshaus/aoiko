// 商店の課金。プラグインの JS API は npm で別配布だが、入口が 4 つしか要らないので
// invoke を直に叩く。aoiko-native も同じ書き方で、新しい npm 依存を増やさない。
//
// 品目 ID は商店ごとに違う。web 側は kind でしか呼ばず、この表だけが実際の ID を知る。
const PRODUCT_IDS = {
  macos: {
    tip: 'net.lonshaus.aoiko.mac.tip',
    'supporter-badge': 'net.lonshaus.aoiko.mac.supporterbadge',
  },
  ios: {
    tip: 'net.lonshaus.aoiko.ios.tip',
    'supporter-badge': 'net.lonshaus.aoiko.ios.supporterbadge',
  },
  windows: {
    tip: 'net.lonshaus.aoiko.win.tip',
    'supporter-badge': 'net.lonshaus.aoiko.win.supporterbadge',
  },
  android: {
    tip: 'net.lonshaus.aoiko.android.tip',
    'supporter-badge': 'net.lonshaus.aoiko.android.supporterbadge',
  },
};
// 商店 も Play も、消耗しない品目と分けるためにこの区別を要求する。
// 定期購読は扱わないので inapp 固定。
const PRODUCT_TYPE = 'inapp';
// プラグインが返す purchaseState（0/1/2）。web 側の語彙へ移す。
const PURCHASE_STATE = { 0: 'purchased', 1: 'cancelled', 2: 'pending' };
// 消耗しない品目。買い切りで、consume はしない。
const NON_CONSUMABLE = 'supporter-badge';
// Play だけの後始末が要る商店。非消耗型を 3 日以内に acknowledge しないと自動返金される
// （消耗型は consume が acknowledge を兼ねる）。商店 と 商店 に同じ仕組みは
// 無く、プラグイン側も no-op か「未対応」で拒否する。
const PLAY = 'android';
// Play の保留（コンビニ払い等）を見つけるための間隔と上限。
const PENDING_POLL_MS = 1000;
const PENDING_POLL_LIMIT = 20;
// race の勝者が「保留だった」ことを示す目印。購入オブジェクトと取り違えない。
const PENDING = Symbol('pending');

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
// get_product_status の戻り。保留の購入が商店側に残っている状態。
export function isPendingStatus(status) {
  return status?.isOwned === true && PURCHASE_STATE[status.purchaseState] === 'pending';
}
// acknowledge がまだの購入。Play はこれを 3 日放置すると自動で返金する。
export function needsAcknowledge(purchase) {
  return purchase?.isAcknowledged === false && typeof purchase?.purchaseToken === 'string';
}

// プラグインは取消と保留を戻り値ではなく例外で伝える。放置すると未捕捉の例外として
// エラーバナーが点く。
export function purchaseResultOfError(error) {
  // プラグインは Error を文字列へ直列化して寄越すので、判るのは文面だけ。
  // 商店 は「cancelled by user」、商店 は「[purchaseNotCompleted] - ...」。
  const message = String(error?.message ?? error ?? '').toLowerCase();
  if (message.includes('cancel') || message.includes('notcompleted')) {
    return 'cancelled';
  }
  if (message.includes('pending')) {
    return 'pending';
  }
  return null;
}

// 課金画面が出ている間はこちらが hidden になる。一度隠れて戻ってくるまでは、
// 結果が出ていなくて当たり前なので待つ側の時計を進めない。
function whenBackFromStore() {
  if (typeof document === 'undefined') {
    return Promise.resolve();
  }
  return waitForVisibility('hidden').then(() => waitForVisibility('visible'));
}

function waitForVisibility(state) {
  if (document.visibilityState === state) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const onChange = () => {
      if (document.visibilityState === state) {
        document.removeEventListener('visibilitychange', onChange);
        resolve();
      }
    };
    document.addEventListener('visibilitychange', onChange);
  });
}

export function createIap(invoke, platform, deps = {}) {
  const ids = productIdsFor(platform);
  // 品目を商店に作っていない環境では表を置かない。表が無ければ入口ごと生やさず、
  // 支援画面が出ないままにする（能力判定は関数の有無で行われる）。
  if (ids === null) {
    return null;
  }
  const isPlay = platform === PLAY;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const backFromStore = deps.backFromStore ?? whenBackFromStore;
  // 非消耗型は acknowledge しないと Play が自動返金する。購入直後と、起動時の復元で
  // 取りこぼしを拾う（購入の途中でアプリが落ちると直後の呼び出しが飛ぶ）。
  async function acknowledgeIfNeeded(purchase) {
    if (!isPlay || !needsAcknowledge(purchase)) {
      return;
    }
    await invoke('plugin:iap|acknowledge_purchase', {
      payload: { purchaseToken: purchase.purchaseToken },
    });
  }
  // Play の保留を自力で見つける。プラグインの handlePurchase は PURCHASED のときしか
  // 応じないので、保留のままだと purchase の約束が解決も拒否もされずに残る。
  // 他の商店ではプラグインが必ず決着させるため、待つ側を生やさない。
  function watchPending(productId, settled) {
    if (!isPlay) {
      return new Promise(() => {});
    }
    return (async () => {
      await backFromStore();
      let lastError = null;
      for (let i = 0; i < PENDING_POLL_LIMIT; i += 1) {
        // 購入が決着していれば race は既に終わっている。ここで何かを返すと、
        // 成功した購入を保留と読み違える取り違えが起きる。
        if (settled.done) {
          await new Promise(() => {});
        }
        try {
          const status = await invoke('plugin:iap|get_product_status', {
            payload: { productId, productType: PRODUCT_TYPE },
          });
          if (isPendingStatus(status)) {
            return PENDING;
          }
          lastError = null;
        } catch (error) {
          // billing client が一時的に落ちていることがある。理由は捨てず、
          // 見切りをつけるときの文面に載せる。
          lastError = error;
        }
        await sleep(PENDING_POLL_MS);
      }
      const reason = lastError === null ? '' : `: ${lastError}`;
      throw new Error(`購入の結果を確認できませんでした${reason}`);
    })();
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
    const settled = { done: false };
    let purchase;
    try {
      purchase = await Promise.race([
        invoke('plugin:iap|purchase', {
          payload: { productId, productType: PRODUCT_TYPE },
        }).finally(() => {
          settled.done = true;
        }),
        watchPending(productId, settled),
      ]);
    } catch (error) {
      const fromError = purchaseResultOfError(error);
      if (fromError === null) {
        throw error;
      }
      return fromError;
    }
    if (purchase === PENDING) {
      return 'pending';
    }
    const result = purchaseResultOf(purchase);
    if (result !== 'purchased') {
      return result;
    }
    if (kind === NON_CONSUMABLE) {
      await acknowledgeIfNeeded(purchase);
      return result;
    }
    // 消耗型は finish しないと同じ品目を二度買えない。スタンプは何度でも押せる
    // ものなので、確定した時点で必ず消費する。Play では consume が acknowledge を兼ねる。
    if (purchase.purchaseToken) {
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
    const owned = [];
    for (const purchase of purchases) {
      // 戻すのは非消耗型だけ。消耗型は買い切りの記録が端末に残るもので、
      // 商店から取り戻す対象ではない。
      if (kindFor(platform, purchase.productId) !== NON_CONSUMABLE) {
        continue;
      }
      // 保留のままの購入を「持っている」に数えると、支払い前にバッジが点く。
      if (purchaseResultOf(purchase) !== 'purchased') {
        continue;
      }
      // 購入の途中でアプリが落ちると acknowledge が飛ぶ。ここが最後の受け皿で、
      // 取りこぼすと 3 日後に Play が返金する。
      await acknowledgeIfNeeded(purchase);
      owned.push(NON_CONSUMABLE);
    }
    return owned;
  }

  return { listIapProducts, purchaseIap, restoreIapPurchases };
}
