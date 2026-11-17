import { db } from '../db/db';
import type { JournalEntry, JournalLine } from '../db/types';
import { todayISO } from '../lib/date';
import { newId } from '../lib/id';
import { isProcessingYear } from '../lib/initial-processing-year';
import { m } from '../paraglide/messages';
import { isReadableEntryDate } from './restore-validate';
import { writeReversal } from './reverse';
import { assertYearsWritable, markConfirmedWrite } from './year-lock';
// 旧バージョンの領収書読み取りが YYYY-MM-DD 以外の日付で保存した確定仕訳を直す。確定仕訳は
// 書き換えないので、訂正仕訳で取り消してから正しい日付で同じ内容を登録し直す。

export interface UnreadableDateEntry {
  entry: JournalEntry;
  lines: JournalLine[];
  attachmentCount: number;
}

function isTarget(entry: JournalEntry | undefined): entry is JournalEntry {
  return (
    entry !== undefined &&
    entry.status === 'confirmed' &&
    entry.originalEntryId === undefined &&
    !isReadableEntryDate(entry.date)
  );
}

export function isExistingDate(date: string): boolean {
  if (!isReadableEntryDate(date)) {
    return false;
  }
  const y = Number(date.slice(0, 4));
  const mo = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

export async function listUnreadableDateEntries(): Promise<UnreadableDateEntry[]> {
  const entries = (await db.journalEntries.filter(isTarget).toArray()).sort(
    (a, b) => a.createdAt - b.createdAt,
  );
  const out: UnreadableDateEntry[] = [];
  for (const entry of entries) {
    out.push({
      entry,
      lines: await db.journalLines.where('entryId').equals(entry.id).toArray(),
      attachmentCount: await db.attachments.where('entryId').equals(entry.id).count(),
    });
  }
  return out;
}
// 申告済みかを確かめる年度。元の年度は整数のときだけ（0 も含める）。
export function entryDateFixYears(entry: JournalEntry, newDate: string): number[] {
  const years = [Number(newDate.slice(0, 4))];
  if (Number.isInteger(entry.year)) {
    years.unshift(entry.year);
  }
  return [...new Set(years)];
}

async function loadTarget(entryId: string): Promise<{ entry: JournalEntry; lines: JournalLine[] }> {
  const entry = await db.journalEntries.get(entryId);
  if (!isTarget(entry)) {
    throw new Error(m.entry_date_fix_error_not_target());
  }
  const lines = await db.journalLines.where('entryId').equals(entryId).toArray();
  if (lines.length === 0) {
    throw new Error(m.error_journal_no_lines());
  }
  return { entry, lines };
}

export async function correctEntryDate(
  entryId: string,
  newDate: string,
  options?: { allowedFiledYears?: readonly number[] },
): Promise<{ reversalId: string; newEntryId: string }> {
  const newYear = Number(newDate.slice(0, 4));
  if (!isExistingDate(newDate) || !isProcessingYear(newYear)) {
    throw new Error(m.entry_date_fix_error_date());
  }
  const { entry } = await loadTarget(entryId);
  await assertYearsWritable(entryDateFixYears(entry, newDate), options);
  const today = todayISO();
  const now = Date.now();
  const newEntryId = newId();
  const reversalId = await db.transaction(
    'rw',
    [db.journalEntries, db.journalLines, db.attachments, db.reportSnapshots],
    async () => {
      markConfirmedWrite(options);
      // 外で確かめた後に別の操作で訂正されていることがあるので、取引の中で読み直す。
      const { entry: orig, lines } = await loadTarget(entryId);
      const id = await writeReversal(orig, lines, today, now);
      // source は引き継がない。期首・繰越・貸倒の仕訳として扱われないように。
      await db.journalEntries.add({
        id: newEntryId,
        date: newDate,
        year: newYear,
        description: orig.description,
        ...(orig.department === undefined ? {} : { department: orig.department }),
        source: 'manual',
        status: 'confirmed',
        createdAt: now,
        confirmedAt: now,
      });
      for (const line of lines) {
        await db.journalLines.add({ ...line, id: newId(), entryId: newEntryId });
      }
      const attachments = await db.attachments.where('entryId').equals(orig.id).toArray();
      for (const attachment of attachments) {
        await db.attachments.add({
          ...attachment,
          id: newId(),
          entryId: newEntryId,
          createdAt: now,
        });
      }
      return id;
    },
  );
  return { reversalId, newEntryId };
}
