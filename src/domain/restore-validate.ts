import type { BackupPayload } from '../backup';
import { m } from '../paraglide/messages';
// 復元前のスキーマ検証。db.delete() で全消去する前に呼び、不正なバックアップで
// 既存データを失うのを防ぐ。会計の根幹（仕訳・明細）は型まで検証し、
// その他の既知テーブルは「オブジェクトで主キーを持つ」ことだけ確認する。

export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupValidationError';
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(table: string, index: number, detail: string): never {
  throw new BackupValidationError(
    m.error_backup_record_invalid({ table, index: index + 1, detail }),
  );
}
// 既知テーブルの主キー列。ここに無いテーブル名は復元時に無視される（破壊はしない）。
export const PRIMARY_KEY: Record<string, string> = {
  journalEntries: 'id',
  journalLines: 'id',
  accounts: 'code',
  subAccounts: 'id',
  vendors: 'id',
  fixedAssets: 'id',
  parserRules: 'id',
  importBatches: 'id',
  reportSnapshots: 'id',
  settings: 'key',
  inventoryItems: 'id',
  personalDeductions: 'year',
  attachments: 'id',
  budgets: 'year',
  arApEntries: 'id',
  invoices: 'id',
};
// 意図的に復元しないテーブル。PRIMARY_KEY に載せないことで「無視される」を利用している。
// 載せてしまうと、手で書き換えたバックアップから別端末のスタンプを持ち込めてしまう。
// backup/payload.ts の SKIP_TABLES（書き出し側）と対。
export const NEVER_RESTORED = new Set(['stamps']);

function validateJournalEntry(r: unknown, i: number): void {
  if (!isObject(r)) {
    fail('journalEntries', i, 'オブジェクトではありません');
  }
  if (typeof r.id !== 'string' || r.id.length === 0) {
    fail('journalEntries', i, 'id が不正');
  }
  if (typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
    fail('journalEntries', i, 'date が YYYY-MM-DD ではありません');
  }
  if (typeof r.year !== 'number' || !Number.isInteger(r.year)) {
    fail('journalEntries', i, 'year が整数ではありません');
  }
  if (r.status !== 'confirmed' && r.status !== 'reversed') {
    fail('journalEntries', i, `status が不正：${String(r.status)}`);
  }
}

function validateJournalLine(r: unknown, i: number): void {
  if (!isObject(r)) {
    fail('journalLines', i, 'オブジェクトではありません');
  }
  if (typeof r.id !== 'string' || r.id.length === 0) {
    fail('journalLines', i, 'id が不正');
  }
  if (typeof r.entryId !== 'string' || r.entryId.length === 0) {
    fail('journalLines', i, 'entryId が不正');
  }
  if (r.side !== 'debit' && r.side !== 'credit') {
    fail('journalLines', i, `side が不正：${String(r.side)}`);
  }
  if (typeof r.accountCode !== 'string' || r.accountCode.length === 0) {
    fail('journalLines', i, 'accountCode が不正');
  }
  // 負の金額は validateLines も toIndexable も禁じている。ここだけ通すと、改竄または
  // 破損したバックアップ経由でしか作れない負金額の明細が DB に入る。
  if (typeof r.amount !== 'string' || !/^\d+(\.\d+)?$/.test(r.amount)) {
    fail('journalLines', i, `amount が非負の数値文字列ではありません：${String(r.amount)}`);
  }
  // toIndexable の出力形式（整数部ゼロ詰め + 小数部固定長）。索引の並びが壊れると
  // 金額範囲検索が黙って誤った結果を返すため、形式まで見る。
  if (typeof r.amountIndexed !== 'string' || !/^\d+\.\d+$/.test(r.amountIndexed)) {
    fail('journalLines', i, `amountIndexed が不正：${String(r.amountIndexed)}`);
  }
  if (typeof r.taxRate !== 'number') {
    fail('journalLines', i, 'taxRate が数値ではありません');
  }
}

function validateGeneric(table: string, keyField: string, r: unknown, i: number): void {
  if (!isObject(r)) {
    fail(table, i, 'オブジェクトではありません');
  }
  const key = r[keyField];
  if (typeof key !== 'string' && typeof key !== 'number') {
    fail(table, i, `主キー ${keyField} がありません`);
  }
}
/**
 * 明細が実在する仕訳を指しているか。仕訳の無い明細を入れてしまうと、仕訳の一覧にも
 * 修正の対象にも出てこないのに試算表の合計だけ狂うため、画面から追えなくなる。
 *
 * 書き込み側は 1 つのトランザクションで両方を書くのでこの状態は作れない。手で編集した
 * バックアップや、途中で壊れたファイルへの備え。
 */
function validateLineReferences(entries: unknown[], lines: unknown[]): void {
  const entryIds = new Set<string>();
  for (const r of entries) {
    if (isObject(r) && typeof r.id === 'string') {
      entryIds.add(r.id);
    }
  }
  lines.forEach((r, i) => {
    if (isObject(r) && typeof r.entryId === 'string' && !entryIds.has(r.entryId)) {
      fail('journalLines', i, `entryId に対応する仕訳がありません：${r.entryId}`);
    }
  });
}
// payload 全体を検証する。問題があれば BackupValidationError を投げる（呼出元は削除前に検証する）。
export function validateBackupPayload(payload: BackupPayload): void {
  if (!isObject(payload.tables)) {
    throw new BackupValidationError(m.error_backup_tables_not_object());
  }
  for (const [name, rows] of Object.entries(payload.tables)) {
    if (!Array.isArray(rows)) {
      throw new BackupValidationError(m.error_backup_table_not_array({ name }));
    }
    const keyField = PRIMARY_KEY[name];
    if (!keyField) {
      continue;
    }
    rows.forEach((r, i) => {
      if (name === 'journalEntries') {
        validateJournalEntry(r, i);
      } else if (name === 'journalLines') {
        validateJournalLine(r, i);
      } else {
        validateGeneric(name, keyField, r, i);
      }
    });
  }
  const entries = payload.tables.journalEntries;
  const lines = payload.tables.journalLines;
  if (Array.isArray(entries) && Array.isArray(lines)) {
    validateLineReferences(entries, lines);
  }
}
