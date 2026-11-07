import Dexie from 'dexie';
import { db } from '../db/db';
import type { JournalEntry, JournalLine } from '../db/types';
import { newId } from '../lib/id';
import { todayISO } from '../lib/date';
import { isYearLocked } from './snapshots';
import { markConfirmedWrite } from './year-lock';
import { m } from '../paraglide/messages';
// 訂正仕訳：原仕訳の借方/貸方を入れ替えた打消し仕訳を新規作成し、
// 原仕訳を status='reversed' に変更する。元データは削除しない（電子帳簿保存法の要件）。
// 集計はペア除外方式（countsTowardTotals 参照）：原仕訳・訂正仕訳とも集計から除外され、
// 正味の効果はゼロになる。訂正仕訳はあくまで訂正履歴の記録として帳簿に残る。
// 戻り値は新しく作られた訂正仕訳の id。
// 原仕訳の年度がロック済みの場合は既定で訂正不可。allowedFiledYears は呼び出し側が警告を
// 表示した上で、見せた年度に限って明示的にオプトインするための抜け道（#339 の修正申告フロー向け）。
// 訂正仕訳が記帳される年度（今日）自体のロックは判定しない：訂正仕訳は originalEntryId を
// 持ち countsTowardTotals から除外されるため、今日の年度の集計には一切影響しないため。
export async function reverseEntry(
  entryId: string,
  options?: { allowedFiledYears?: readonly number[] },
): Promise<string> {
  const orig = await db.journalEntries.get(entryId);
  if (!orig) {
    throw new Error(m.error_journal_not_found());
  }
  if (orig.status === 'reversed') {
    throw new Error(m.error_journal_already_reversed());
  }
  if (orig.originalEntryId !== undefined) {
    throw new Error(m.error_journal_reversal_not_reversible());
  }
  // 整数でない年度は申告できないので未申告として扱う（索引の範囲も作れない）。
  if (
    Number.isInteger(orig.year) &&
    !options?.allowedFiledYears?.includes(orig.year) &&
    (await isYearLocked(orig.year))
  ) {
    throw new Error(m.error_journal_year_locked({ year: orig.year }));
  }

  const today = todayISO();

  const lines = await db.journalLines.where('entryId').equals(entryId).toArray();
  if (lines.length === 0) {
    throw new Error(m.error_journal_no_lines());
  }
  const now = Date.now();

  return db.transaction(
    'rw',
    [db.journalEntries, db.journalLines, db.reportSnapshots],
    async () => {
      markConfirmedWrite(options);
      return writeReversal(orig, lines, today, now);
    },
  );
}
/**
 * 訂正仕訳と明細を書き、原仕訳を訂正済みにする。呼出側の取引の中で使い、申告済み年度の印も
 * 呼出側が付ける。戻り値は訂正仕訳の id。
 */
export async function writeReversal(
  orig: JournalEntry,
  lines: readonly JournalLine[],
  today: string,
  now: number,
): Promise<string> {
  if (Dexie.currentTransaction === null) {
    throw new Error('writeReversal は取引の中で呼ぶ');
  }
  const newEntryId = newId();
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
      // 金額には影響しない（原仕訳と訂正仕訳は対で集計から除外される）が、
      // 転記しないと帳簿上の訂正仕訳が原仕訳と違う税区分・数量に見える。
      ...(line.taxCategory ? { taxCategory: line.taxCategory } : {}),
      ...(line.inputUsageCategory ? { inputUsageCategory: line.inputUsageCategory } : {}),
      ...(line.itemId ? { itemId: line.itemId } : {}),
      ...(line.quantity ? { quantity: line.quantity } : {}),
    });
  }

  await db.journalEntries.update(orig.id, {
    status: 'reversed',
    reversedByEntryId: newEntryId,
  });
  return newEntryId;
}
