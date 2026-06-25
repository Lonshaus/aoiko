// aoiko 業務データ → KOA020（確定申告書）定義側（IT部）値マップ。
//
// ⚠ aoiko は確定申告書本体に必要な個人情報（氏名・住所・個人番号・各種所得控除・
// 税額計算）を収集しない設計。安全に対映できるのは年分と屋号のみ。
// 未収集の定義項目は出力しない（IDREF 整合は buildXtxDocument が保証）。
// 損益・貸借・月別は青色申告決算書（KOA210, Sub D）の領域で本様式には含まれない。

import koa020 from './xtx-schema-koa020.generated.json';
import type { XtxSchema } from './xtx-schema';
import type { XtxContext } from './xtx';
import type { XtxValues, XtxLeafValues } from './xtx-document';

const SCHEMA = koa020 as XtxSchema;
// 西暦 → 令和年（令和1年=2019）。NENBUN は gen:yy（非負整数）
function toReiwa(year: number): string {
  const r = year - 2018;
  return r >= 1 ? String(r) : '';
}
// gen:kingaku は xsd:long（整数円）。Decimal 文字列 → 整数円（小数切捨て・カンマ除去）
function toKingaku(s: string): string {
  const t = s.replace(/,/g, '').trim();
  const m = /^(-?)(\d+)(?:\.\d+)?$/.exec(t);
  if (!m) {
    return '';
  }
  const sign = m[1] === '-' ? '-' : '';
  const digits = m[2]!.replace(/^0+(?=\d)/, '');
  if (digits === '0') {
    return '0';
  }
  return `${sign}${digits}`;
}
// KOA020 第一表（KOA020-1）内で、日本語名が完全一致する最初の直接値 leaf tag を返す。
function firstTableLeafTagByJa(ja: string): string | undefined {
  let inFirstTable = false;
  for (const e of SCHEMA.refTree) {
    if (e.level === 1) {
      inFirstTable = e.tag === 'KOA020-1';
    }
    if (inFirstTable && e.kind === 'leaf' && !e.idref && e.ja === ja) {
      return e.tag;
    }
  }
  return undefined;
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
// KOA020 第一表（KOA020-1）の直接値 leaf。aoiko が決算書から正確に導けるのは
// 「収入金額等＞事業＞営業等(ア)」＝事業の総収入のみ。事業の所得金額(①)は
// 青色申告特別控除後の額（aoiko 未計算）・各種所得控除・税額計算は本人情報が必要なため
// 本様式には載せず、利用者が e-Tax 上で補完する（申告書本体の性質上不可避）。
export function mapKoa020LeafValues(ctx: XtxContext): XtxLeafValues {
  const out: XtxLeafValues = {};
  const eigyoIncome = firstTableLeafTagByJa('営業等　金額');
  if (eigyoIncome) {
    const v = toKingaku(ctx.pl.totalRevenue);
    if (v !== '') {
      out[eigyoIncome] = v;
    }
  }
  return out;
}