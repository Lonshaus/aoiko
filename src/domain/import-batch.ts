import { db } from '../db/db';
import { reverseEntry } from './reverse';
// インポートバッチに紐付くすべての仕訳を訂正する。
// 既に訂正済みの行も件数に含めて返す（UI が「全件訂正済み」を表示できるように）。
export async function reverseImportBatch(
  batchId: string,
): Promise<{ reversedCount: number; alreadyReversedCount: number }> {
  const entries = await db.journalEntries.where('sourceImportId').equals(batchId).toArray();

  let reversedCount = 0;
  let alreadyReversedCount = 0;
  for (const entry of entries) {
    if (entry.status === 'reversed') {
      alreadyReversedCount++;
      continue;
    }
    await reverseEntry(entry.id);
    reversedCount++;
  }
  return { reversedCount, alreadyReversedCount };
}
