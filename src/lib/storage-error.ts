import { m } from '../paraglide/messages';
// 歴史的に NS_ERROR_DOM_QUOTA_REACHED を使うブラウザがある（現行仕様は QuotaExceededError）。
const QUOTA_ERROR_NAMES = new Set(['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED']);

export function isQuotaExceededError(e: unknown): boolean {
  return e instanceof DOMException && QUOTA_ERROR_NAMES.has(e.name);
}
export function isDecimalError(e: unknown): boolean {
  return e instanceof Error && e.message.startsWith('[DecimalError]');
}
const DATABASE_WRITE_ERROR_NAMES = new Set([
  'ConstraintError',
  'AbortError',
  'BulkError',
  'TransactionInactiveError',
  'InvalidStateError',
  'UnknownError',
]);
// IndexedDB / OPFS の生例外をそのまま出さず、利用者向けの文言に変換する。
// 容量不足・読めない保存済みの金額・書き込みの失敗以外は、従来どおり message をそのまま表示する。
export function describeStorageError(e: unknown): string {
  if (isQuotaExceededError(e)) {
    return m.common_storage_full();
  }
  if (e === null || e === undefined) {
    return m.common_storage_write_failed();
  }
  if (isDecimalError(e)) {
    return m.common_stored_amount_error();
  }
  const name = (e as { name?: unknown }).name;
  if (typeof name === 'string' && DATABASE_WRITE_ERROR_NAMES.has(name)) {
    return m.common_storage_write_failed();
  }
  return e instanceof Error ? e.message : String(e);
}
