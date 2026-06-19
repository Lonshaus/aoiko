import { db } from '../db/db';
import { toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { countsTowardTotals } from './journal';
import type { JournalLine } from '../db/types';
import type { ParsedTransaction } from '../parsers/types';

export interface ImportRow {
  transaction: ParsedTransaction;
  counterpartAccountCode: string;
  counterpartSubAccountId?: string;
  description?: string;  // ユーザーが上書きした摘要（空なら parser 由来を使用）
  skip?: boolean;
  // 相手科目（費用・収益）側の税区分。未指定なら 0（非課税扱い）。
  // 本則課税では仕入税額控除・売上税額の基礎になるため、確定前に正しく設定する。
  counterpartTaxRate?: number;
  counterpartInvoiceCompliant?: boolean;
}

export interface ImportBatchInfo {
  parserName: string;
  fileName: string;
  fileHash: string;
  knownAccountCode: string;
  knownSubAccountId?: string;
}

export class DuplicateImportError extends Error {
  constructor(public readonly previousImport: { fileName: string; importedAt: number }) {
    super(`このファイルは既にインポート済みです（${previousImport.fileName}, ${new Date(previousImport.importedAt).toLocaleDateString('ja-JP')}）`);
    this.name = 'DuplicateImportError';
  }
}
// CSV インポートを 1 トランザクションで確定する。
// - fileHash で重複チェック → 同じ内容なら DuplicateImportError
// - skip / counterpartAccountCode 未設定の行は除外
// - 各行から借方 1 + 貸方 1 の仕訳を生成、source='csv', sourceImportId=batchId を付与
export async function commitImport(
  info: ImportBatchInfo,
  rows: ImportRow[]
): Promise<{ batchId: string; entryCount: number }> {
  const existing = await db.importBatches
    .where('fileHash')
    .equals(info.fileHash)
    .first();
  if (existing) {
    throw new DuplicateImportError({
      fileName: existing.fileName,
      importedAt: existing.importedAt,
    });
  }

  const validRows = rows.filter(
    (r) => !r.skip && r.counterpartAccountCode.length > 0
  );
  if (validRows.length === 0) {
    throw new Error('登録対象の行がありません');
  }

  const batchId = newId();
  const now = Date.now();

  await db.transaction(
    'rw',
    [db.journalEntries, db.journalLines, db.importBatches],
    async () => {
      await db.importBatches.add({
        id: batchId,
        parserName: info.parserName,
        fileName: info.fileName,
        fileHash: info.fileHash,
        importedAt: now,
        rowCount: validRows.length,
      });

      for (const row of validRows) {
        const tx = row.transaction;
        const entryId = newId();

        await db.journalEntries.add({
          id: entryId,
          date: tx.date,
          year: Number(tx.date.slice(0, 4)),
          description:
            row.description && row.description.length > 0
              ? row.description
              : tx.description,
          status: 'confirmed',
          source: 'csv',
          sourceImportId: batchId,
          createdAt: now,
          confirmedAt: now,
        });

        const knownLine: JournalLine = {
          id: newId(),
          entryId,
          side: tx.side,
          accountCode: info.knownAccountCode,
          ...(info.knownSubAccountId
            ? { subAccountId: info.knownSubAccountId }
            : {}),
          amount: tx.amount,
          amountIndexed: toIndexable(tx.amount),
          taxRate: 0,
          taxIncluded: true,
          invoiceCompliant: false,
        };
        const counterpartLine: JournalLine = {
          id: newId(),
          entryId,
          side: tx.side === 'debit' ? 'credit' : 'debit',
          accountCode: row.counterpartAccountCode,
          ...(row.counterpartSubAccountId
            ? { subAccountId: row.counterpartSubAccountId }
            : {}),
          amount: tx.amount,
          amountIndexed: toIndexable(tx.amount),
          taxRate: row.counterpartTaxRate ?? 0,
          taxIncluded: true,
          invoiceCompliant: row.counterpartInvoiceCompliant ?? false,
        };

        await db.journalLines.bulkAdd([knownLine, counterpartLine]);
      }
    }
  );

  return { batchId, entryCount: validRows.length };
}
// 期間が重複する明細ファイル（例：「1〜3月」と「2〜4月」を別々にダウンロード）を
// 二重計上しないよう、既存の CSV 由来仕訳と (日付・既知側科目・側・金額) で軟突合する。
// 全ファイル SHA-256 では中身が 1 行違うだけで別ファイル扱いになり重複を防げないため補完する。
// 多重集合として数えるので、同日同額の真の取引 2 件のうち既存が 1 件なら 1 件だけを候補にする。
// ハードブロックはしない（同額取引の誤検知回避）。戻り値は重複候補の行インデックス集合。
export async function findOverlappingRows(
  transactions: Pick<ParsedTransaction, 'date' | 'amount' | 'side'>[],
  knownAccountCode: string
): Promise<Set<number>> {
  const flagged = new Set<number>();
  if (transactions.length === 0) {
    return flagged;
  }
  const lines = await db.journalLines
    .where('accountCode')
    .equals(knownAccountCode)
    .toArray();
  if (lines.length === 0) {
    return flagged;
  }
  const entryIds = [...new Set(lines.map((l) => l.entryId))];
  const entries = await db.journalEntries.where('id').anyOf(entryIds).toArray();
  const csvEntryById = new Map(
    entries.filter((e) => e.source === 'csv' && countsTowardTotals(e)).map((e) => [e.id, e])
  );
  const counts = new Map<string, number>();
  for (const l of lines) {
    const e = csvEntryById.get(l.entryId);
    if (!e) {
      continue;
    }
    const key = `${e.date}|${l.side}|${l.amount}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  transactions.forEach((tx, i) => {
    const key = `${tx.date}|${tx.side}|${tx.amount}`;
    const remaining = counts.get(key) ?? 0;
    if (remaining > 0) {
      flagged.add(i);
      counts.set(key, remaining - 1);
    }
  });
  return flagged;
}
// SHA-256 を 16 進数文字列で返す。crypto.subtle はブラウザ・Node 22 双方で利用可能。
export async function computeFileHash(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}