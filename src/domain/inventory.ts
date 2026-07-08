import { db } from '../db/db';
import { D, type Decimal } from '../lib/decimal';
import { countsTowardTotals } from './journal';
// 簡易在庫管理（C4）。最終仕入原価法（評価方法の届出を提出していない事業者に
// 適用される法定デフォルト）のみ対応する。届出により他の評価方法（先入先出法・
// 移動平均法等）を選んでいる利用者は Settings の inventoryAutoValuationEnabled を
// false にして本機能を無効化し、従来通り手動で期末棚卸高を仕訳する
// （詳細は PJ_aoiko/AOIKO_FUTURE_IDEAS.md 参照）。
//
// 品目ごとの現在庫数量・直近仕入単価は別途可変状態として保持せず、確定仕訳
// （JournalLine.itemId/quantity）から都度導出する（CLAUDE.md「仕訳が唯一の
// 真実の情報源」の原則。既存の buildPL/buildBS/computeDepreciation と同じく
// 純粋な導出計算とする）。

const PURCHASE_ACCOUNT_CODE = '5020'; // 仕入
const SALES_ACCOUNT_CODE = '4110'; // 売上高

export interface ItemValuation {
  itemId: string;
  quantity: Decimal;
  unitCost: Decimal;
  value: Decimal;
}

export interface InventoryValuation {
  items: ItemValuation[];
  totalValue: Decimal;
}
// asOfDate（当日を含む）までの確定仕訳から、品目ごとの在庫数量・直近仕入単価を
// 導出し、最終仕入原価法で評価した期末棚卸高を返す。同一日付内の複数仕入は
// entries を日付昇順で処理した際の後勝ちとする（日付のみの粒度のため、同日内の
// 順序は厳密には決定不能。実務上の影響は軽微と判断）。
export async function computeInventoryValuation(asOfDate: string): Promise<InventoryValuation> {
  const entries = (await db.journalEntries.where('date').belowOrEqual(asOfDate).toArray())
    .filter(countsTowardTotals)
    .sort((a, b) => a.date.localeCompare(b.date));
  const entryIds = entries.map((e) => e.id);
  const lines = entryIds.length > 0 ? await db.journalLines.where('entryId').anyOf(entryIds).toArray() : [];
  const linesByEntry = new Map<string, typeof lines>();
  for (const line of lines) {
    const arr = linesByEntry.get(line.entryId) ?? [];
    arr.push(line);
    linesByEntry.set(line.entryId, arr);
  }

  const quantity = new Map<string, Decimal>();
  const unitCost = new Map<string, Decimal>();
  for (const entry of entries) {
    for (const line of linesByEntry.get(entry.id) ?? []) {
      if (!line.itemId || !line.quantity) {
        continue;
      }
      const qty = D(line.quantity);
      if (line.accountCode === PURCHASE_ACCOUNT_CODE) {
        quantity.set(line.itemId, (quantity.get(line.itemId) ?? D(0)).plus(qty));
        if (qty.greaterThan(0)) {
          unitCost.set(line.itemId, D(line.amount).dividedBy(qty));
        }
      } else if (line.accountCode === SALES_ACCOUNT_CODE) {
        quantity.set(line.itemId, (quantity.get(line.itemId) ?? D(0)).minus(qty));
      }
    }
  }

  const items: ItemValuation[] = [];
  let totalValue = D(0);
  for (const [itemId, qty] of quantity) {
    const cost = unitCost.get(itemId) ?? D(0);
    const value = qty.greaterThan(0) ? qty.times(cost) : D(0);
    items.push({ itemId, quantity: qty, unitCost: cost, value });
    totalValue = totalValue.plus(value);
  }
  return { items, totalValue };
}