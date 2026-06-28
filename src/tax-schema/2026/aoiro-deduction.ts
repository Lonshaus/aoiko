import { D, type Decimal } from '../../lib/decimal';
// 青色申告特別控除の区分。確定申告書・決算書の控除額算定に用いる。
//  - electronic：正規の簿記（複式）＋ e-Tax 申告 or 優良な電子帳簿 → 65万（令和8年分）/ 75万（令和9年分〜）
//  - doubleEntry：正規の簿記（複式）のみ（紙申告・非優良）→ 55万
//  - simple：簡易簿記 → 10万
//  - none：控除なし
export type AoiroDeductionKind = 'electronic' | 'doubleEntry' | 'simple' | 'none';
// 区分ごとの控除限度額（円）。年分で電子区分の額が変わる（令和9年分〜は 75万）。
export function aoiroDeductionLimit(
  year: number,
  kind: AoiroDeductionKind
): Decimal {
  switch (kind) {
    case 'electronic':
      // 令和9年分（2027）以降は 75万円、それ以前は 65万円。
      return D(year >= 2027 ? 750000 : 650000);
    case 'doubleEntry':
      return D(550000);
    case 'simple':
      return D(100000);
    case 'none':
      return D(0);
  }
}
// 実際の青色申告特別控除額。控除前の事業所得（黒字分）を上限とする
// （赤字には適用せず、限度額と控除前所得の小さい方・下限 0）。
export function aoiroDeductionAmount(
  year: number,
  kind: AoiroDeductionKind,
  preDeductionIncome: Decimal
): Decimal {
  const base = preDeductionIncome.greaterThan(0) ? preDeductionIncome : D(0);
  const limit = aoiroDeductionLimit(year, kind);
  return base.lessThan(limit) ? base : limit;
}