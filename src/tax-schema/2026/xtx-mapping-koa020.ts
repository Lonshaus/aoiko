// aoiko 業務データ → KOA020（確定申告書）の値マップ。
//
// ⚠ 申告者情報（氏名・住所・税務署）は IT部（定義側）から第一表へ IDREF で反映される
// （buildItPart が出力）。本モジュールは第一表の「事業」部分の直接値 leaf を扱う：
// 営業等収入金額・事業所得（青色控除後）・青色申告特別控除額・所得金額（合計）。
// 各種所得控除・税額計算は本人情報が必要なため載せず、利用者が e-Tax 上で補完する。

import koa020 from './xtx-schema-koa020.generated.json';
import { D } from '../../lib/decimal';
import { aoiroDeductionAmount } from './aoiro-deduction';
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
// KOA020 第一表（KOA020-1）の「事業」部分の直接値 leaf。
//  - 営業等収入金額(ア)＝売上(収入)合計
//  - 事業 営業等所得金額(①)＝控除前事業所得 − 青色申告特別控除額
//  - 青色申告特別控除額
// 合計所得金額(⑫) は e-Tax が自動計算するため載せない（ja「所得金額」は
// その他＞変動・臨時所得金額 の子要素 ABB00870 で別物のため誤対映を避ける）。
// 各種所得控除・税額は本人情報が必要なため載せず、利用者が e-Tax 上で補完する。
function put(out: XtxLeafValues, ja: string, amount: string): void {
  const tag = firstTableLeafTagByJa(ja);
  if (!tag) {
    return;
  }
  const v = toKingaku(amount);
  if (v !== '') {
    out[tag] = v;
  }
}

export function mapKoa020LeafValues(ctx: XtxContext): XtxLeafValues {
  const out: XtxLeafValues = {};
  const preIncome = D(ctx.pl.netIncome);
  const deduction = aoiroDeductionAmount(ctx.year, ctx.aoiroDeductionKind, preIncome);
  const businessIncome = preIncome.minus(deduction);
  put(out, '営業等　金額', ctx.pl.totalRevenue);
  put(out, '営業等', businessIncome.toString());
  put(out, '青色申告特別控除額', deduction.toString());
  return out;
}