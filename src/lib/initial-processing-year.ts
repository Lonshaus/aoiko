// 処理年度として受け付ける範囲。設定画面の年度欄（min / max）と同じ。
export const PROCESSING_YEAR_MIN = 2020;
export const PROCESSING_YEAR_MAX = 2099;

export function isProcessingYear(v: unknown): v is number {
  return (
    typeof v === 'number' &&
    Number.isInteger(v) &&
    v >= PROCESSING_YEAR_MIN &&
    v <= PROCESSING_YEAR_MAX
  );
}
// 初回起動時の処理年度。端末のローカル時刻の西暦年を使う。時計がずれていても範囲内に収める。
export function initialProcessingYear(now: Date): number {
  const year = now.getFullYear();
  if (!Number.isFinite(year)) {
    return PROCESSING_YEAR_MIN;
  }
  return Math.min(PROCESSING_YEAR_MAX, Math.max(PROCESSING_YEAR_MIN, year));
}
