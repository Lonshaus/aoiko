// toISOString() は UTC 変換のため、JST 00:00〜08:59 では前日の日付になる。
// 帳簿の「今日」はローカル（=利用者の生活時間）基準で生成する。
export function toISODateLocal(d: Date): string {
  const y = String(d.getFullYear()).padStart(4, '0');
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return toISODateLocal(new Date());
}