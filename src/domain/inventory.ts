import { db } from '../db/db';
import { loadAccountsForYear } from '../db/year-accounts';
import { D, type Decimal } from '../lib/decimal';
import { countsTowardTotals } from './journal';
import { isReadableEntryDate } from './restore-validate';
import type { YearData } from './reports';
import type { JournalEntry, JournalLine } from '../db/types';
// 簡易在庫管理。最終仕入原価法（評価方法の届出を提出していない事業者に
// 適用される法定デフォルト）のみ対応する。届出により他の評価方法（先入先出法・
// 移動平均法等）を選んでいる利用者は Settings の inventoryAutoValuationEnabled を
// false にして本機能を無効化し、従来通り手動で期末棚卸高を仕訳する。
//
// 品目ごとの現在庫数量・直近仕入単価は別途可変状態として保持せず、確定仕訳
// （JournalLine.itemId/quantity）から都度導出する（仕訳が唯一の真実の情報源という
// 原則による。既存の buildPL/buildBS/computeDepreciation と同じく
// 純粋な導出計算とする）。

const PURCHASE_ACCOUNT_CODE = '5020'; // 仕入
const SALES_ACCOUNT_CODE = '4110'; // 売上高

interface ItemValuation {
  itemId: string;
  quantity: Decimal;
  unitCost: Decimal;
  value: Decimal;
}

export interface InventoryValuation {
  items: ItemValuation[];
  totalValue: Decimal;
}
export interface InventorySource {
  entries: JournalEntry[];
  lines: JournalLine[];
}
// 年度データと在庫評価用のデータを、仕訳 1 回・明細 1 回の読み込みでまとめて取る。
// 年度側は loadYearData と同じ集合・順序、在庫側は date 索引の読み取りと同じ集合・順序にする。
export async function loadYearDataWithInventory(
  year: number,
  asOfDate: string,
): Promise<{ yearData: YearData; inventory: InventorySource }> {
  const all = await db.journalEntries.filter(countsTowardTotals).toArray();
  const yearEntries = all.filter((e) => e.year === year);
  // cmp は索引に入らない値（有効な key でない日付）で例外を投げる。その行は索引にも無い。
  const inventoryEntries = all
    .filter((e) => {
      try {
        return indexedDB.cmp(e.date, asOfDate) <= 0;
      } catch {
        return false;
      }
    })
    .sort((a, b) => indexedDB.cmp(a.date, b.date));
  const ids = new Set([...yearEntries, ...inventoryEntries].map((e) => e.id));
  const lines =
    ids.size > 0
      ? await db.journalLines
          .where('entryId')
          .anyOf([...ids])
          .toArray()
      : [];
  const pick = (entries: JournalEntry[]): JournalLine[] => {
    const own = new Set(entries.map((e) => e.id));
    return lines.filter((l) => own.has(l.entryId));
  };
  const accounts = yearEntries.length > 0 ? await loadAccountsForYear(year) : [];
  return {
    yearData: { entries: yearEntries, lines: pick(yearEntries), accounts },
    inventory: { entries: inventoryEntries, lines: pick(inventoryEntries) },
  };
}
// asOfDate（当日を含む）までの確定仕訳から、品目ごとの在庫数量・直近仕入単価を
// 導出し、最終仕入原価法で評価した期末棚卸高を返す。同一日付内の複数仕入は
// entries を日付昇順で処理した際の後勝ちとする（日付のみの粒度のため、同日内の
// 順序は厳密には決定不能。実務上の影響は軽微と判断）。
// source を渡した場合は、読み込み済みの仕訳と明細から評価する。
export async function computeInventoryValuation(
  asOfDate: string,
  source?: InventorySource,
): Promise<InventoryValuation> {
  const entries = (
    source ? source.entries : await db.journalEntries.where('date').belowOrEqual(asOfDate).toArray()
  )
    .filter((e) => countsTowardTotals(e) && isReadableEntryDate(e.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  const entryIds = entries.map((e) => e.id);
  const lines = source
    ? source.lines
    : entryIds.length > 0
      ? await db.journalLines.where('entryId').anyOf(entryIds).toArray()
      : [];
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
      // 両建ては side で正味集計する（plContribution と同じ考え方）。仕入の貸方は
      // 仕入返品・返金で在庫が減り、売上の借方は売上返品で在庫が戻る。
      if (line.accountCode === PURCHASE_ACCOUNT_CODE) {
        const isPurchase = line.side === 'debit';
        const delta = isPurchase ? qty : qty.negated();
        quantity.set(line.itemId, (quantity.get(line.itemId) ?? D(0)).plus(delta));
        // 返品・返金の金額で直近仕入単価を上書きしない。
        if (isPurchase && qty.greaterThan(0)) {
          unitCost.set(line.itemId, D(line.amount).dividedBy(qty));
        }
      } else if (line.accountCode === SALES_ACCOUNT_CODE) {
        const delta = line.side === 'credit' ? qty.negated() : qty;
        quantity.set(line.itemId, (quantity.get(line.itemId) ?? D(0)).plus(delta));
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
