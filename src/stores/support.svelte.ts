import { db } from '../db/db';
import { getSetting, setSetting } from '../lib/settings';
import { newId } from '../lib/id';
import { todayISO } from '../lib/date';
import { TIP_TIERS, isTipKind, stampPageCount, stampPageSlots, type Stamp } from '../domain/stamps';
import {
  nativeBridge,
  type IapProduct,
  type IapProductKind,
  type IapPurchaseResult,
} from '../lib/native-bridge';

class SupportStore {
  stamps = $state<Stamp[]>([]);
  // 支援者バッジを買った日。null は未購入。
  badgeAt = $state<string | null>(null);
  products = $state<IapProduct[]>([]);
  page = $state(0);
  busy = $state(false);
  // 直前に押したスタンプ。押した瞬間だけ動きを付けるために持つ。
  justStamped = $state<string | null>(null);

  pageCount = $derived(stampPageCount(this.stamps.length));
  slots = $derived(stampPageSlots(this.stamps, this.page));

  productFor(kind: IapProductKind): IapProduct | undefined {
    return this.products.find((p) => p.kind === kind);
  }

  async load(): Promise<void> {
    // 押した順。id は UUID で順序を持たないので at で並べ、同日内は挿入順のままにする。
    this.stamps = await db.stamps.orderBy('at').toArray();
    this.badgeAt = (await getSetting('supporterBadgeAt')) ?? null;
    // 最後の頁を開く。集めたものを見せる画面なので、白紙の 1 頁目より新しい方が要る。
    this.page = stampPageCount(this.stamps.length) - 1;
    const bridge = nativeBridge();
    if (typeof bridge?.listIapProducts === 'function') {
      this.products = await bridge.listIapProducts();
    }
  }

  async purchase(kind: IapProductKind): Promise<IapPurchaseResult | 'unavailable'> {
    const bridge = nativeBridge();
    if (typeof bridge?.purchaseIap !== 'function' || this.busy) {
      return 'unavailable';
    }
    this.busy = true;
    try {
      const result = await bridge.purchaseIap(kind);
      if (result === 'purchased') {
        await this.grant(kind);
      }
      return result;
    } finally {
      this.busy = false;
    }
  }

  async restore(): Promise<IapProductKind[] | 'unavailable'> {
    const bridge = nativeBridge();
    if (typeof bridge?.restoreIapPurchases !== 'function' || this.busy) {
      return 'unavailable';
    }
    this.busy = true;
    try {
      const restored = await bridge.restoreIapPurchases();
      // 復元の対象は非消耗型だけ。スタンプは消耗型なので戻ってこないし、戻したくもない
      // （この端末の記録だと画面で言っている）。
      if (restored.includes('supporter-badge') && this.badgeAt === null) {
        await this.setBadge();
      }
      return restored;
    } finally {
      this.busy = false;
    }
  }

  // 購入が確定したときだけ通る。ここを画面から直接呼ばないのは、商店を通さずに
  // スタンプが増える経路を作らないため。
  private async grant(kind: IapProductKind): Promise<void> {
    if (isTipKind(kind)) {
      const stamp: Stamp = { id: newId(), tier: TIP_TIERS[kind], at: todayISO() };
      await db.stamps.put(stamp);
      this.stamps = [...this.stamps, stamp];
      this.page = this.pageCount - 1;
      this.justStamped = stamp.id;
      return;
    }
    if (kind === 'supporter-badge') {
      await this.setBadge();
    }
  }

  private async setBadge(): Promise<void> {
    const at = todayISO();
    await setSetting('supporterBadgeAt', at);
    this.badgeAt = at;
  }
}

export const support = new SupportStore();
