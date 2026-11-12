import { db } from '../db/db';
import { reverseEntry } from './reverse';
// インポートバッチに紐付くすべての仕訳を訂正する。
// 既に訂正済みの行も件数に含めて返す（UI が「全件訂正済み」を表示できるように）。
export async function reverseImportBatch(
  batchId: string,
  options?: { allowedFiledYears?: readonly number[] },
): Promise<{ reversedCount: number; alreadyReversedCount: number }> {
  const entries = await db.journalEntries.where('sourceImportId').equals(batchId).toArray();

  let reversedCount = 0;
  let alreadyReversedCount = 0;
  for (const entry of entries) {
    if (entry.status === 'reversed') {
      alreadyReversedCount++;
      continue;
    }
    await reverseEntry(entry.id, options);
    reversedCount++;
  }
  return { reversedCount, alreadyReversedCount };
}
// バッチに紐付く仕訳の対象年度一覧（重複排除・昇順）。呼び出し側が申告済み年度への
// 警告を出す前に確認するために使う。整数でない年度は申告できず、照会の範囲も作れないので除く。
export async function importBatchYears(batchId: string): Promise<number[]> {
  const entries = await db.journalEntries.where('sourceImportId').equals(batchId).toArray();
  const years = entries.map((e) => e.year).filter((y) => Number.isInteger(y));
  return Array.from(new Set(years)).sort((a, b) => a - b);
}
