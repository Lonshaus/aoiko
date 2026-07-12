import type { BackupPayload } from '../backup';
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
  throw new BackupValidationError(`バックアップの ${table} ${index + 1} 件目が不正です：${detail}`);
}
// 既知テーブルの主キー列。ここに無いテーブル名は復元時に無視される（破壊はしない）。
const PRIMARY_KEY: Record<string, string> = {
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
  if (typeof r.amount !== 'string' || !/^-?\d+(\.\d+)?$/.test(r.amount)) {
    fail('journalLines', i, `amount が数値文字列ではありません：${String(r.amount)}`);
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
// payload 全体を検証する。問題があれば BackupValidationError を投げる（呼出元は削除前に検証する）。
export function validateBackupPayload(payload: BackupPayload): void {
  if (!isObject(payload.tables)) {
    throw new BackupValidationError('tables がオブジェクトではありません');
  }
  for (const [name, rows] of Object.entries(payload.tables)) {
    if (!Array.isArray(rows)) {
      throw new BackupValidationError(`${name} が配列ではありません`);
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
}
