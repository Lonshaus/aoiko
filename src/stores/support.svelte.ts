import { db } from '../db/db';
import { getSetting, setSetting } from '../lib/settings';
import { todayISO } from '../lib/date';
import { stampPageCount, stampPageSlots, type Stamp } from '../domain/stamps';
import {
  nativeBridge,
  type IapProduct,
  type IapProductKind,
  type IapPurchaseResult,
} from '../lib/native-bridge';

const KINDS: IapProductKind[] = ['supporter-badge'];

class SupportStore {
  stamps = $state<Stamp[]>([]);
  // 支援者バッジを買った日。null は未購入。
  badgeAt = $state<string | null>(null);
  products = $state<IapProduct[]>([]);
  // 一度でもストアへ問い合わせたか。問い合わせる前と、問い合わせて欠けていた状態は別物。
  productsAsked = $state(false);
  page = $state(0);
  busy = $state(false);

  pageCount = $derived(stampPageCount(this.stamps.length));
  slots = $derived(stampPageSlots(this.stamps, this.page));
  hasStamps = $derived(this.stamps.length > 0);
  // ストアが品目を返さないことがある（実機で観測）。揃っていないことを画面へ伝えるため、
  // 取り出せなかった品目を隠さずここで判る形にしておく。
  productsMissing = $derived(this.productsAsked && this.products.length < KINDS.length);

  productFor(kind: IapProductKind): IapProduct | undefined {
    return this.products.find((p) => p.kind === kind);
  }

  async load(): Promise<void> {
    // 押した順。at は日付までしか無く id は UUID v4 なので、この索引でしか押した順に戻せない。
    this.stamps = await db.stamps.orderBy('createdAt').toArray();
    this.badgeAt = (await getSetting('supporterBadgeAt')) ?? null;
    // 最後の頁を開く。集めたものを見せる画面なので、白紙の 1 頁目より新しい方が要る。
    this.page = stampPageCount(this.stamps.length) - 1;
    await this.loadProducts();
  }

  async loadProducts(): Promise<void> {
    const bridge = nativeBridge();
    if (typeof bridge?.listIapProducts !== 'function') {
      return;
    }
    this.products = await bridge.listIapProducts();
    this.productsAsked = true;
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
        // 購入が確定したときだけバッジを付ける。画面から直接呼べる経路は作らない。
        await this.setBadge();
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
      if (restored.includes('supporter-badge') && this.badgeAt === null) {
        await this.setBadge();
      }
      return restored;
    } finally {
      this.busy = false;
    }
  }

  private async setBadge(): Promise<void> {
    const at = todayISO();
    await setSetting('supporterBadgeAt', at);
    this.badgeAt = at;
  }
}

export const support = new SupportStore();
