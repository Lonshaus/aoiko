import type { BackupPayload } from '../backup';
import {
  ATTACHMENT_TABLES,
  BOOK_TABLES,
  DEVICE_ONLY_TABLES,
  FULL_PAYLOAD_VERSION,
  hasFullPayloadParts,
  isBackupPartId,
  isRestorableSettingKey,
  settingKeyPart,
  sortBackupParts,
  type BackupPartId,
} from '../backup/parts';
import type { Decimal } from '../lib/decimal';
import { parseLegacyLineAmount } from '../lib/amount-input';
import { m } from '../paraglide/messages';
import { checkRow, clip, describeValue, upgradeLegacyRow } from './restore-schema';
// 復元前のスキーマ検証。全消去の前に呼び、不正なバックアップで既存データを失うのを防ぐ。
// 既知の表は列の仕様（restore-schema.ts）で型まで確かめ、settings は復元する区分のキーだけを
// 確かめる。旧バージョンの形は複製の上で今の型へ直してから確かめる。含まれる区分の判定
// （resolveBackupParts）も検証済みの複製に対して行う。

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
    m.error_backup_record_invalid({ table: clip(table), index: index + 1, detail }),
  );
}
// 既知テーブルの主キー列（Dexie の keyPath と同じ形）。ここに無いテーブル名は復元時に無視される。
export const PRIMARY_KEY: Readonly<Record<string, string | readonly string[]>> = {
  journalEntries: 'id',
  journalLines: 'id',
  accounts: ['code', 'year'],
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
  budgets: ['year', 'month'],
  arApEntries: 'id',
  invoices: 'id',
};
// 意図的に復元しないテーブル。PRIMARY_KEY に載せないことで「無視される」を利用している。
// 載せてしまうと、手で書き換えたバックアップから別端末のスタンプを持ち込めてしまう。
export const NEVER_RESTORED: ReadonlySet<string> = new Set(DEVICE_ONLY_TABLES);

export function isReadableEntryDate(date: unknown): boolean {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date);
}
// 旧バージョンの領収書読み取りは任意の日付文字列を保存し、年度は NaN（JSON では null）や 0 になった。
// その形の仕訳も復元して、画面から登録し直せるようにする。
export function journalEntryProblem(r: unknown): string | null {
  if (!isObject(r)) {
    return 'オブジェクトではありません';
  }
  if (typeof r.id !== 'string' || r.id.length === 0) {
    return 'id が不正';
  }
  if (typeof r.date !== 'string') {
    return 'date が YYYY-MM-DD ではありません';
  }
  if (isReadableEntryDate(r.date)) {
    if (typeof r.year !== 'number' || !Number.isInteger(r.year)) {
      return 'year が整数ではありません';
    }
  } else if (typeof r.year !== 'number' && r.year !== null) {
    return 'year が整数ではありません';
  }
  if (r.status !== 'confirmed' && r.status !== 'reversed') {
    return `status が不正：${describeValue(r.status)}`;
  }
  return null;
}

const PLAIN_AMOUNT = /^\d+(\.\d+)?$/;
// 旧バージョンの toIndexable と同じ形（小数 2 桁、整数部を 14 桁にゼロ詰め、それより長くても切らない）。投げない
function legacyIndex(d: Decimal): string {
  const [i = '0', f = ''] = d.toFixed(2).split('.');
  return `${i.padStart(14, '0')}.${f.padEnd(2, '0')}`;
}

export function journalLineProblem(r: unknown): string | null {
  if (!isObject(r)) {
    return 'オブジェクトではありません';
  }
  if (typeof r.id !== 'string' || r.id.length === 0) {
    return 'id が不正';
  }
  if (typeof r.entryId !== 'string' || r.entryId.length === 0) {
    return 'entryId が不正';
  }
  if (r.side !== 'debit' && r.side !== 'credit') {
    return `side が不正：${describeValue(r.side)}`;
  }
  if (typeof r.accountCode !== 'string' || r.accountCode.length === 0) {
    return 'accountCode が不正';
  }
  // 負の金額は validateLines も toIndexable も禁じている。ここだけ通すと、改竄または
  // 破損したバックアップ経由でしか作れない負金額の明細が DB に入る。
  // 旧バージョンが保存した 1e3・.5 のような書き方は、読めて範囲内なら受け入れる。
  const amount = Object.hasOwn(r, 'amount') ? r.amount : undefined;
  const legacy =
    typeof amount === 'string' && !PLAIN_AMOUNT.test(amount)
      ? parseLegacyLineAmount(amount)
      : undefined;
  if (typeof amount !== 'string' || (!PLAIN_AMOUNT.test(amount) && legacy === undefined)) {
    return `amount が非負の数値文字列ではありません：${describeValue(amount)}`;
  }
  // 課税資産の譲渡等の対価も消費税の計算と会計士向け CSV が金額として読む。対応する索引は無い
  if (Object.hasOwn(r, 'taxableTransferConsideration')) {
    const c = r.taxableTransferConsideration;
    if (
      c !== undefined &&
      (typeof c !== 'string' || (!PLAIN_AMOUNT.test(c) && parseLegacyLineAmount(c) === undefined))
    ) {
      return `taxableTransferConsideration が非負の数値文字列ではありません：${describeValue(c)}`;
    }
  }
  // toIndexable の出力形式（整数部ゼロ詰め + 小数部固定長）。索引の並びが壊れると
  // 金額範囲検索が黙って誤った結果を返すため、形式まで見る。
  const amountIndexed = Object.hasOwn(r, 'amountIndexed') ? r.amountIndexed : undefined;
  if (typeof amountIndexed !== 'string' || !/^\d+\.\d+$/.test(amountIndexed)) {
    return `amountIndexed が不正：${describeValue(amountIndexed)}`;
  }
  // 通常の表記以外は、索引が金額と食い違っていないかも確かめる
  if (legacy !== undefined && amountIndexed !== legacyIndex(legacy)) {
    return `amountIndexed が amount と一致しません：${describeValue(amountIndexed)}`;
  }
  if (typeof r.taxRate !== 'number') {
    return 'taxRate が数値ではありません';
  }
  return null;
}

function validateJournalEntry(r: unknown, i: number): void {
  const problem = journalEntryProblem(r);
  if (problem !== null) {
    fail('journalEntries', i, problem);
  }
}

function validateJournalLine(r: unknown, i: number): void {
  const problem = journalLineProblem(r);
  if (problem !== null) {
    fail('journalLines', i, problem);
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
      fail('journalLines', i, `entryId に対応する仕訳がありません：${clip(r.entryId)}`);
    }
  });
}
type Level = 'root' | 'tables' | 'table' | 'row' | 'other';
interface Visit {
  v: unknown;
  level: Level;
  table: string;
  index: number;
  path: string;
}

function childVisit(parent: Visit, key: string, v: unknown, inArray: boolean): Visit {
  switch (parent.level) {
    case 'root':
      return { v, level: key === 'tables' ? 'tables' : 'other', table: '', index: -1, path: '' };
    case 'tables':
      return { v, level: 'table', table: key, index: -1, path: '' };
    case 'table':
      return inArray
        ? { v, level: 'row', table: parent.table, index: Number(key), path: '' }
        : { v, level: 'other', table: '', index: -1, path: '' };
    case 'row': {
      const segment = inArray ? `[${key}]` : clip(key);
      const path =
        parent.path === '' || inArray ? `${parent.path}${segment}` : `${parent.path}.${segment}`;
      return { v, level: 'row', table: parent.table, index: parent.index, path };
    }
    case 'other':
      return { v, level: 'other', table: '', index: -1, path: '' };
  }
}
/**
 * 複製を作る前に、受け取ったオブジェクトそのものを走査する。プロトタイプを差し替えたものや
 * __proto__ を自分の欄に持つものを通すと、複製では消えるのに元の参照からは見える値が残り、
 * 検証を素通りする。
 */
function assertPlainTree(payload: unknown): void {
  const stack: Visit[] = [{ v: payload, level: 'root', table: '', index: -1, path: '' }];
  const seen = new Set<object>();
  for (let visit = stack.pop(); visit !== undefined; visit = stack.pop()) {
    const { v } = visit;
    if (typeof v !== 'object' || v === null || seen.has(v)) {
      continue;
    }
    seen.add(v);
    const inArray = Array.isArray(v);
    const plain = Object.getPrototypeOf(v) === (inArray ? Array.prototype : Object.prototype);
    const hasProtoKey = Object.hasOwn(v, '__proto__');
    if (!plain || hasProtoKey) {
      if (visit.level !== 'row') {
        throw new BackupValidationError(m.error_backup_not_backup_format());
      }
      const where = visit.path === '' ? '行' : `${visit.path} `;
      fail(
        visit.table,
        visit.index,
        hasProtoKey
          ? `${where}に __proto__ という名前の欄があります`
          : `${where}が通常のオブジェクトではありません`,
      );
    }
    const record = v as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      stack.push(childVisit(visit, key, record[key], inArray));
    }
  }
}
// 走査済みの木を複製する。素のオブジェクトと配列だけを複製し、それ以外の値（関数など
// 保存できない値を含む）はそのまま残して、失敗を従来どおり全消去後の書き込みで起こす。
function copyTree(v: unknown, memo: Map<object, unknown>): unknown {
  if (typeof v !== 'object' || v === null) {
    return v;
  }
  const done = memo.get(v);
  if (done !== undefined) {
    return done;
  }
  if (Array.isArray(v) && Object.getPrototypeOf(v) === Array.prototype) {
    const out: unknown[] = [];
    memo.set(v, out);
    for (const item of v) {
      out.push(copyTree(item, memo));
    }
    return out;
  }
  if (Object.getPrototypeOf(v) === Object.prototype) {
    const out: Record<string, unknown> = {};
    memo.set(v, out);
    for (const [key, item] of Object.entries(v)) {
      out[key] = copyTree(item, memo);
    }
    return out;
  }
  return v;
}

export function primaryKeyProblem(key: string | readonly string[], r: unknown): string | null {
  if (!isObject(r)) {
    return 'オブジェクトではありません';
  }
  for (const field of typeof key === 'string' ? [key] : key) {
    const v = Object.hasOwn(r, field) ? r[field] : undefined;
    if (typeof v !== 'string' && typeof v !== 'number') {
      return `主キー ${field} がありません`;
    }
  }
  return null;
}

function assertPrimaryKey(
  table: string,
  key: string | readonly string[],
  r: unknown,
  i: number,
): asserts r is Record<string, unknown> {
  const problem = primaryKeyProblem(key, r);
  if (problem !== null) {
    fail(table, i, problem);
  }
}
// 1 表分を確かめ、旧形式を直した行の配列を返す。
function validateRows(name: string, key: string | readonly string[], rows: unknown[]): unknown[] {
  const kept: unknown[] = [];
  rows.forEach((r, i) => {
    assertPrimaryKey(name, key, r, i);
    if (name === 'journalEntries') {
      validateJournalEntry(r, i);
    } else if (name === 'journalLines') {
      validateJournalLine(r, i);
    }
    // 復元しない設定キー（端末専用・旧キー・未知のキー）は見ない。restore.ts も書き込まない。
    if (name === 'settings' && !isRestorableSettingKey(r.key)) {
      kept.push(r);
      return;
    }
    if (!upgradeLegacyRow(name, r)) {
      return;
    }
    const detail = checkRow(name, r);
    if (detail !== null) {
      fail(name, i, detail);
    }
    kept.push(r);
  });
  return kept;
}
/**
 * payload 全体を検証し、旧形式を直した複製を返す。問題があれば BackupValidationError を投げる
 * （呼出元は全消去の前に呼び、以降は返した複製だけを読む）。
 */
export function validateBackupPayload(payload: BackupPayload): BackupPayload {
  assertPlainTree(payload);
  if (!Object.hasOwn(payload, 'tables') || !isObject(payload.tables)) {
    throw new BackupValidationError(m.error_backup_tables_not_object());
  }
  const copy = copyTree(payload, new Map()) as BackupPayload;
  const tables = copy.tables;
  for (const name of Object.keys(tables)) {
    const rows = tables[name];
    if (!Array.isArray(rows)) {
      throw new BackupValidationError(m.error_backup_table_not_array({ name: clip(name) }));
    }
    const key = Object.hasOwn(PRIMARY_KEY, name) ? PRIMARY_KEY[name] : undefined;
    if (key === undefined) {
      continue;
    }
    tables[name] = validateRows(name, key, rows);
  }
  const entries = Object.hasOwn(tables, 'journalEntries') ? tables.journalEntries : undefined;
  const lines = Object.hasOwn(tables, 'journalLines') ? tables.journalLines : undefined;
  if (Array.isArray(entries) && Array.isArray(lines)) {
    validateLineReferences(entries, lines);
  }
  return copy;
}

function failParts(): never {
  throw new BackupValidationError(m.error_backup_parts_invalid());
}

function hasTable(tables: Record<string, unknown[]>, name: string): boolean {
  return Object.hasOwn(tables, name) && Array.isArray(tables[name]);
}
/**
 * 検証済みの複製から、バックアップが含む区分を標準の順序で返す。parts が無いのは
 * 区分を書かなかった旧バージョン（version 1）の形で、そのときは中身から推定する。
 */
export function resolveBackupParts(copy: BackupPayload): BackupPartId[] {
  const tables = copy.tables;
  if (Object.hasOwn(copy, 'parts')) {
    const raw = copy.parts;
    if (!Array.isArray(raw)) {
      failParts();
    }
    const parts = new Set<BackupPartId>();
    for (const v of raw) {
      if (!isBackupPartId(v) || parts.has(v)) {
        failParts();
      }
      parts.add(v);
    }
    if (parts.has('attachments') && !parts.has('books')) {
      failParts();
    }
    if (copy.version === FULL_PAYLOAD_VERSION && !hasFullPayloadParts(parts)) {
      failParts();
    }
    // 名乗った区分の表が欠けていると、その区分を消したまま書き戻せない。
    if (parts.has('books') && !BOOK_TABLES.every((name) => hasTable(tables, name))) {
      failParts();
    }
    if (parts.has('attachments') && !ATTACHMENT_TABLES.every((name) => hasTable(tables, name))) {
      failParts();
    }
    return sortBackupParts(parts);
  }
  if (copy.version !== FULL_PAYLOAD_VERSION) {
    failParts();
  }
  const parts = new Set<BackupPartId>(['books', 'business', 'ai']);
  if (Object.hasOwn(tables, 'attachments')) {
    parts.add('attachments');
  }
  const settings = Object.hasOwn(tables, 'settings') ? tables.settings : undefined;
  for (const r of settings ?? []) {
    const part = settingKeyPart((r as { key?: unknown }).key);
    if (part === 'apiKeys' || part === 'filer') {
      parts.add(part);
    }
  }
  return sortBackupParts(parts);
}
