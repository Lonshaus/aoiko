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
// YYYY-MM-DD の形で、実在する日付か
export function isValidIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return false;
  }
  const [y = 0, mo = 0, d = 0] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}
