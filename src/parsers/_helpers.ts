// CSV パーサー間で共有される小さなユーティリティ。
// YYYY/MM/DD・YYYY-MM-DD・YYYY.MM.DD・YYYY年M月D日を 'YYYY-MM-DD' に正規化。
// 末尾に時刻（' HH:MM:SS' 等）が付く形式（PayPay 等）は日付部分のみ採用。
// 月を m という名前で分解しているので、こちらは別名で受ける。
import { m as msg } from '../paraglide/messages';
import { parseAmountInput } from '../lib/amount-input';
import type { ParsedTransaction } from './types';
export function normalizeDate(s: string): string {
  const dateOnly = (s.trim().split(/[ \t]/)[0] ?? '').replace(/年|月/g, '/').replace(/日/g, '');
  const parts = dateOnly.split(/[/\-.]/).map((p) => p.trim());
  if (parts.length !== 3) {
    throw new Error(msg.error_date_format_unrecognized({ value: s }));
  }
  const [y, m, d] = parts;
  // 年は 4 桁、月日は 1〜2 桁の数字に限定する。2 桁年や非数字を弾き、
  // year 欄が NaN になる・無効な日付が通るのを防ぐ（確認済みの実フォーマットはすべて西暦）。
  if (!y || !/^\d{4}$/.test(y) || !m || !/^\d{1,2}$/.test(m) || !d || !/^\d{1,2}$/.test(d)) {
    throw new Error(msg.error_date_format_unrecognized({ value: s }));
  }
  const mn = Number(m);
  const dn = Number(d);
  if (mn < 1 || mn > 12 || dn < 1 || dn > 31) {
    throw new Error(msg.error_date_out_of_range({ value: s }));
  }
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export function stripComma(s: string): string {
  return s.replace(/,/g, '');
}
// 返金・キャンセル行は負数金額で現れる（ParsedTransaction.amount は必ず非負の契約）。
// 負数表記なら絶対値にして side を反転する（クレジットカードなら未払金の減少 = 借方）。
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
// カード明細 CSV はカード名・支払日等の冒頭の情報行＋空行の後にヘッダー行が来る形式が多い。
// 必須列名をすべて含む最初の行をヘッダー行とみなし、その行インデックスを返す。
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

export type ParsedAmountIssueReason = 'invalid' | 'too_large';

export interface ParsedAmountIssue {
  // 取込一覧での順番（1 始まり）。画面には出さず、一覧の行との対応づけにだけ使う
  row: number;
  date: string;
  description: string;
  raw: string;
  reason: ParsedAmountIssueReason;
}
// 仕訳明細の金額は 0 以上・14 桁以内しか保存できない。「1,234円」のような書き方を
// そのまま通すと、一覧の表示と取込の両方で例外になる
export function checkParsedAmount(
  raw: string,
): { ok: true; amount: string } | { ok: false; reason: ParsedAmountIssueReason } {
  const d = parseAmountInput(raw);
  if (d === undefined) {
    return { ok: false, reason: 'invalid' };
  }
  if (d.gte('1e14')) {
    return { ok: false, reason: 'too_large' };
  }
  return { ok: true, amount: d.toFixed() };
}
// 読める行は金額を標準の書き方に揃え、読めない行は issues に順番付きで返す（行は除かない）
export function checkParsedAmounts(txs: readonly ParsedTransaction[]): {
  transactions: ParsedTransaction[];
  issues: ParsedAmountIssue[];
} {
  const issues: ParsedAmountIssue[] = [];
  const transactions = txs.map((t, i) => {
    const r = checkParsedAmount(t.amount);
    if (r.ok) {
      return r.amount === t.amount ? t : { ...t, amount: r.amount };
    }
    issues.push({
      row: i + 1,
      date: t.date,
      description: t.description,
      raw: t.amount,
      reason: r.reason,
    });
    return t;
  });
  return { transactions, issues };
}
