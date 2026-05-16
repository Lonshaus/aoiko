// aoiko 業務データ → KOA020（確定申告書）定義側（IT部）値マップ。
//
// ⚠ aoiko は確定申告書本体に必要な個人情報（氏名・住所・個人番号・各種所得控除・
// 税額計算）を収集しない設計。安全に対映できるのは年分と屋号のみ。
// 未収集の定義項目は出力しない（IDREF 整合は buildXtxDocument が保証）。
// 損益・貸借・月別は青色申告決算書（KOA210, Sub D）の領域で本様式には含まれない。

import type { XtxContext } from './xtx';
import type { XtxValues } from './xtx-document';

// 西暦 → 令和年（令和1年=2019）。NENBUN は gen:yy（非負整数）
function toReiwa(year: number): string {
  const r = year - 2018;
  return r >= 1 ? String(r) : '';
}

// 改行・タブを除去（nametype/yagotype の pattern [^\n\r\t]* に適合させる）
function sanitizeLine(s: string): string {
  return s.replace(/[\n\r\t]+/g, ' ').trim();
}

export function mapKoa020Values(ctx: XtxContext): XtxValues {
  const values: XtxValues = {};
  const nenbun = toReiwa(ctx.year);
  if (nenbun) {
    values.NENBUN = nenbun;
  }
  const yago = sanitizeLine(ctx.businessName);
  if (yago) {
    values.NOZEISHA_YAGO = yago;
  }
  return values;
}