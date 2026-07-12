// CSV パーサー間で共有される小さなユーティリティ。
// YYYY/MM/DD・YYYY-MM-DD・YYYY.MM.DD・YYYY年M月D日 を 'YYYY-MM-DD' に正規化。
// 末尾に時刻（' HH:MM:SS' 等）が付く形式（PayPay 等）は日付部分のみ採用。
export function normalizeDate(s: string): string {
  const dateOnly = (s.trim().split(/[ \t]/)[0] ?? '').replace(/年|月/g, '/').replace(/日/g, '');
  const parts = dateOnly.split(/[/\-.]/).map((p) => p.trim());
  if (parts.length !== 3) {
    throw new Error(`日付形式が認識できません: ${s}`);
  }
  const [y, m, d] = parts;
  // 年は 4 桁、月日は 1〜2 桁の数字に限定する。2 桁年や非数字を弾き、
  // year 欄が NaN になる・無効な日付が通るのを防ぐ（確認済みの実フォーマットはすべて西暦）。
  if (!y || !/^\d{4}$/.test(y) || !m || !/^\d{1,2}$/.test(m) || !d || !/^\d{1,2}$/.test(d)) {
    throw new Error(`日付形式が認識できません: ${s}`);
  }
  const mn = Number(m);
  const dn = Number(d);
  if (mn < 1 || mn > 12 || dn < 1 || dn > 31) {
    throw new Error(`日付の範囲が不正です: ${s}`);
  }
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export function stripComma(s: string): string {
  return s.replace(/,/g, '');
}
// 返金・キャンセル行は負数金額で現れる（ParsedTransaction.amount は必ず非負の契約）。
// 負数表記なら絶対値にして side を反転する（クレジットカードなら 未払金の減少 = debit）。
// 対応表記：-1234 / −1234（全角マイナス）/ ▲1234 / △1234
export function applySign(
  amount: string,
  defaultSide: 'debit' | 'credit',
): { amount: string; side: 'debit' | 'credit' } {
  const t = amount.trim();
  const m = /^[-−－▲△]\s*(.+)$/.exec(t);
  if (m) {
    return {
      amount: m[1] ?? '',
      side: defaultSide === 'credit' ? 'debit' : 'credit',
    };
  }
  return { amount: t, side: defaultSide };
}

export function buildRawRow(header: string[], row: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < header.length; i++) {
    result[header[i] ?? ''] = row[i] ?? '';
  }
  return result;
}
// 必須列のインデックスを取得。1 つでも欠けたら早期に投げる。
export function requireColumns(
  header: string[],
  names: readonly string[],
  parserDisplayName: string,
): Record<string, number> {
  const indices: Record<string, number> = {};
  const missing: string[] = [];
  for (const name of names) {
    const idx = header.indexOf(name);
    if (idx < 0) {
      missing.push(name);
    } else {
      indices[name] = idx;
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `${parserDisplayName} の CSV ヘッダー形式と一致しません（不足列：${missing.join(', ')}）`,
    );
  }
  return indices;
}
// オプショナル列のインデックス。無ければ -1。
export function optionalColumn(header: string[], name: string): number {
  return header.indexOf(name);
}
// カード明細 CSV はカード名・支払日等の前言行＋空行の後に表頭が来る形式が多い。
// 必須列名をすべて含む最初の行を表頭とみなし、その行インデックスを返す。
// 見つからなければ -1。
export function findHeaderRow(
  rows: string[][],
  required: readonly string[],
  searchLimit = 30,
): number {
  const limit = Math.min(rows.length, searchLimit);
  for (let i = 0; i < limit; i++) {
    const cells = (rows[i] ?? []).map((c) => c.trim());
    if (required.every((name) => cells.includes(name))) {
      return i;
    }
  }
  return -1;
}
// 明細セクションの後にさらに別表（内訳表・契約情報等）が続く CSV があるため、
// 行が取引データか否かは「日付列が日付らしいか」で判定する。
// YYYY/M/D・YYYY-M-D・YYYY.M.D・YYYY年M月D日（前後空白可）を日付とみなす。
export function isDateLike(s: string): boolean {
  const t = s.trim();
  return (
    /^\d{4}\s*[/\-.]\s*\d{1,2}\s*[/\-.]\s*\d{1,2}/.test(t) ||
    /^\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/.test(t)
  );
}
