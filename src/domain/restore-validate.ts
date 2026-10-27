import type { BackupPayload } from '../backup';
import { D, toIndexable, type Decimal } from '../lib/decimal';
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

const ECHO_LIMIT = 40;
// 有効 28 桁の toString() は指数 -1000〜1000 なら 35 文字以内に収まる。長さで先に切るのは、
// 巨大な 16 進文字列などの解析に時間がかかるのを防ぐため。
const MAX_NON_PLAIN_LENGTH = 64;
const EXPONENT_LIMIT = 1000;

function echo(v: unknown): string {
  return String(v).slice(0, ECHO_LIMIT);
}
// 旧バージョンは入力欄の値（1e3・0x10 など）をそのまま保存していたため、
// 通常の表記以外も数値として読めれば受け入れる。
function parseNonPlainAmount(amount: string, i: number, field: string): Decimal {
  if (amount.length > MAX_NON_PLAIN_LENGTH) {
    fail('journalLines', i, `${field} が長すぎます：${echo(amount)}`);
  }
  let d: Decimal;
  try {
    d = D(amount);
  } catch {
    fail('journalLines', i, `${field} が非負の数値文字列ではありません：${echo(amount)}`);
  }
  if (!d.isFinite() || d.isNegative()) {
    fail('journalLines', i, `${field} が非負の数値文字列ではありません：${echo(amount)}`);
  }
  if (!(d.e >= -EXPONENT_LIMIT && d.e <= EXPONENT_LIMIT)) {
    fail('journalLines', i, `${field} の桁数が範囲外です：${echo(amount)}`);
  }
  return d;
}
// 金額欄の検査（文字列であること・通常の表記・それ以外は読めて非負で指数が範囲内）。索引との突き合わせは呼び出し側
function validateLineAmountText(v: unknown, i: number, field: string): Decimal | undefined {
  if (typeof v !== 'string') {
    fail('journalLines', i, `${field} が非負の数値文字列ではありません：${echo(v)}`);
  }
  return /^\d+(\.\d+)?$/.test(v) ? undefined : parseNonPlainAmount(v, i, field);
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
  const parsed = validateLineAmountText(r.amount, i, 'amount');
  // 課税資産の譲渡等の対価も消費税の計算と会計士向け CSV が金額として読む。対応する索引は無い
  if (r.taxableTransferConsideration !== undefined) {
    validateLineAmountText(r.taxableTransferConsideration, i, 'taxableTransferConsideration');
  }
  // toIndexable の出力形式（整数部ゼロ詰め + 小数部固定長）。索引の並びが壊れると
  // 金額範囲検索が黙って誤った結果を返すため、形式まで見る。
  if (typeof r.amountIndexed !== 'string' || !/^\d+\.\d+$/.test(r.amountIndexed)) {
    fail('journalLines', i, `amountIndexed が不正：${echo(r.amountIndexed)}`);
  }
  // 通常の表記以外は今回から受け入れる値なので、索引が金額と食い違っていないか確かめる。
  // 1e14 以上と小数 3 桁以上は toIndexable の範囲外なので形式だけ見て通す。
  if (parsed && parsed.lt('1e14') && parsed.decimalPlaces() <= 2) {
    if (r.amountIndexed !== toIndexable(parsed) || !/^\d{14}\.\d{2}$/.test(r.amountIndexed)) {
      fail('journalLines', i, `amountIndexed が amount と一致しません：${echo(r.amountIndexed)}`);
    }
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
