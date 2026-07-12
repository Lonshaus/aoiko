import { db } from '../db/db';
import { newId } from '../lib/id';
import { todayISO } from '../lib/date';
import { isYearLocked } from './snapshots';
// 訂正仕訳：原仕訳の借方/貸方を入れ替えた打消し仕訳を新規作成し、
// 原仕訳を status='reversed' に変更する。元データは削除しない（電子帳簿保存法の要件）。
// 集計は成対排除方式（countsTowardTotals 参照）：原仕訳・訂正仕訳とも集計から除外され、
// 正味の効果はゼロになる。訂正仕訳はあくまで訂正履歴の記録として帳簿に残る。
// 戻り値は新しく作られた訂正仕訳の id。
// 原仕訳の年度、および訂正仕訳が記帳される年度（今日）がロック済みの場合は訂正不可。
export async function reverseEntry(entryId: string): Promise<string> {
  const orig = await db.journalEntries.get(entryId);
  if (!orig) {
    throw new Error('対象の仕訳が見つかりません');
  }
  if (orig.status === 'reversed') {
    throw new Error('すでに訂正済みの仕訳です');
  }
  if (orig.originalEntryId !== undefined) {
    throw new Error(
      '訂正仕訳そのものは訂正できません。必要なら正しい内容で新しい仕訳を入力してください。',
    );
  }

  if (await isYearLocked(orig.year)) {
    throw new Error(
      `${orig.year} 年は申告済みのためロックされています。訂正は新しい年度内の仕訳で対応してください。`,
    );
  }

  const today = todayISO();
  const todayYear = Number(today.slice(0, 4));
  if (todayYear !== orig.year && (await isYearLocked(todayYear))) {
    throw new Error(
      `${todayYear} 年は申告済みのためロックされています。訂正仕訳を記帳できません。`,
    );
  }

  const lines = await db.journalLines.where('entryId').equals(entryId).toArray();
  if (lines.length === 0) {
    throw new Error('明細が存在しない仕訳です');
  }
  const newEntryId = newId();
  const now = Date.now();

  await db.transaction('rw', [db.journalEntries, db.journalLines], async () => {
    await db.journalEntries.add({
      id: newEntryId,
      date: today,
      year: todayYear,
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
  });

  return newEntryId;
}
