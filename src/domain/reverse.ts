import { db } from '../db/db';
import { newId } from '../lib/id';
import { isYearLocked } from './snapshots';
// 訂正仕訳：原仕訳の借方/貸方を入れ替えた打消し仕訳を新規作成し、
// 原仕訳を status='reversed' に変更する。元データは削除しない（電子帳簿保存法の要件）。
// 戻り値は新しく作られた訂正仕訳の id。
// 原仕訳の年度が「申告済み」としてロックされている場合は訂正不可。
export async function reverseEntry(entryId: string): Promise<string> {
  const orig = await db.journalEntries.get(entryId);
  if (!orig) {
    throw new Error('対象の仕訳が見つかりません');
  }
  if (orig.status === 'reversed') {
    throw new Error('すでに訂正済みの仕訳です');
  }

  if (await isYearLocked(orig.year)) {
    throw new Error(
      `${orig.year} 年は申告済みのためロックされています。訂正は新しい年度内の仕訳で対応してください。`
    );
  }

  const lines = await db.journalLines.where('entryId').equals(entryId).toArray();
  if (lines.length === 0) {
    throw new Error('明細が存在しない仕訳です');
  }
  const newEntryId = newId();
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  await db.transaction(
    'rw',
    [db.journalEntries, db.journalLines],
    async () => {
      await db.journalEntries.add({
        id: newEntryId,
        date: today,
        year: Number(today.slice(0, 4)),
        description: `[訂正] ${orig.description}`,
        status: 'confirmed',
        originalEntryId: orig.id,
        source: 'manual',
        createdAt: now,
        confirmedAt: now,
      });

      for (const line of lines) {
        await db.journalLines.add({
          id: newId(),
          entryId: newEntryId,
          side: line.side === 'debit' ? 'credit' : 'debit',
          accountCode: line.accountCode,
          ...(line.subAccountId ? { subAccountId: line.subAccountId } : {}),
          ...(line.vendorId ? { vendorId: line.vendorId } : {}),
          amount: line.amount,
          amountIndexed: line.amountIndexed,
          taxRate: line.taxRate,
          taxIncluded: line.taxIncluded,
          invoiceCompliant: line.invoiceCompliant,
          ...(line.homeOfficeRatio ? { homeOfficeRatio: line.homeOfficeRatio } : {}),
          ...(line.memo ? { memo: line.memo } : {}),
        });
      }

      await db.journalEntries.update(orig.id, {
        status: 'reversed',
        reversedByEntryId: newEntryId,
      });
    }
  );

  return newEntryId;
}