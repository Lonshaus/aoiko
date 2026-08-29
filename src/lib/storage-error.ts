import { m } from '../paraglide/messages';
// 歴史的に NS_ERROR_DOM_QUOTA_REACHED を使うブラウザがある（現行仕様は QuotaExceededError）。
const QUOTA_ERROR_NAMES = new Set(['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED']);

export function isQuotaExceededError(e: unknown): boolean {
  return e instanceof DOMException && QUOTA_ERROR_NAMES.has(e.name);
}
// IndexedDB / OPFS の生例外をそのまま出さず、保存容量不足だけ利用者向けの文言に変換する。
// それ以外の例外は従来どおり message をそのまま表示する。
export function describeStorageError(e: unknown): string {
  if (isQuotaExceededError(e)) {
    return m.common_storage_full();
  }
  return e instanceof Error ? e.message : String(e);
}
