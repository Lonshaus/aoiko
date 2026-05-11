import { db } from '../db/db';
import { toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import type { JournalLine } from '../db/types';
import type { ParsedTransaction } from '../parsers/types';

export interface ImportRow {
  transaction: ParsedTransaction;
  counterpartAccountCode: string;
  counterpartSubAccountId?: string;
  description?: string;  // ユーザーが上書きした摘要（空なら parser 由来を使用）
  skip?: boolean;
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
          taxRate: 0,
          taxIncluded: true,
          invoiceCompliant: false,
        };

        await db.journalLines.bulkAdd([knownLine, counterpartLine]);
      }
    }
  );

  return { batchId, entryCount: validRows.length };
}

// SHA-256 を 16 進数文字列で返す。crypto.subtle はブラウザ・Node 22 双方で利用可能。
export async function computeFileHash(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}