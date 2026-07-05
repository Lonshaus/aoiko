// aoiko 業務データ（PL）→ KOA110（収支内訳書 一般用・白色申告用）参照側
// 直接値 leaf（gen:kingaku 等）への対映。
//
// KOA110 は KOA210 と同じく決算書の金額を要素テキストで直接保持する（leaf.idref 無し）。
//
// 対応できない項目（e-Tax 上で利用者が補完すべき、または白色申告に存在しない）：
//  - 専従者給与：白色申告の「専従者控除」は実際の給与額ではなく続柄で決まる定額
//    （配偶者86万円・その他親族50万円）であり、aoiko は続柄データを持たないため
//    自動算定しない。専従者控除前の所得金額のみ出力し、控除額・控除後所得は
//    利用者が e-Tax 上で補完する
//  - 貸倒引当金繰入額：収支内訳書（一般用）に対応欄が無いため出力しない
//
// ⚠ 専従者控除前の所得金額は pl.netIncome をそのまま使わない。netIncome は
// 専従者給与・貸倒引当金繰入額を含む全経費控除後の値のため、そのまま出すと
// 収支内訳書に転記していない科目の分だけ所得が過小になる。補正は KOA020 側
// （事業所得）とも共通のため white-return-income.ts に切り出している。

import koa110 from './xtx-schema-koa110.generated.json';
import type { XtxSchema } from './xtx-schema';
import type { XtxContext } from './xtx';
import type { XtxLeafValues } from './xtx-document';
import {
  WHITE_RETURN_UNMAPPABLE_EXPENSE_ACCOUNTS,
  whiteReturnAdjustedNetIncome,
} from './white-return-income';

const SCHEMA = koa110 as XtxSchema;

interface Leaf {
  tag: string;
  ja: string;
}
// ページ（KOA110-1..2）ごとの gen:kingaku 直接値 leaf を出現順に収集
function kingakuLeavesByPage(): Map<string, Leaf[]> {
  const byPage = new Map<string, Leaf[]>();
  let page = '';
  for (const e of SCHEMA.refTree) {
    if (e.level === 1) {
      page = e.tag;
      byPage.set(page, []);
    }
    if (e.kind === 'leaf' && !e.idref && e.refType === 'gen:kingaku' && page) {
      byPage.get(page)!.push({ tag: e.tag, ja: e.ja });
    }
  }
  return byPage;
}

const PAGES = kingakuLeavesByPage();
const PAGE1 = PAGES.get('KOA110-1') ?? []; // 収入・経費
// ページ内で日本語名が完全一致する最初の leaf tag を返す
function tagByJa(leaves: Leaf[], ja: string): string | undefined {
  return leaves.find((l) => l.ja === ja)?.tag;
}
// aoiko 勘定科目名 → KOA110 収支内訳書 行名 の差異吸収
const EXPENSE_ALIAS: Record<string, string> = {
  期首商品棚卸高: '期首商品（製品）棚卸高',
  仕入: '仕入金額（製品製造原価）',
  期末商品棚卸高: '期末商品（製品）棚卸高',
};
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

function put(out: XtxLeafValues, tag: string | undefined, amount: string) {
  if (!tag) {
    return;
  }
  const v = toKingaku(amount);
  if (v !== '') {
    out[tag] = v;
  }
}

export function mapKoa110Values(ctx: XtxContext): XtxLeafValues {
  const { pl } = ctx;
  const out: XtxLeafValues = {};
  put(out, tagByJa(PAGE1, '売上（収入）金額'), pl.totalRevenue);
  for (const row of pl.expense) {
    if (WHITE_RETURN_UNMAPPABLE_EXPENSE_ACCOUNTS.has(row.accountName)) {
      continue;
    }
    const ja = EXPENSE_ALIAS[row.accountName] ?? row.accountName;
    put(out, tagByJa(PAGE1, ja), row.amount);
  }
  // 専従者控除前の所得金額。専従者控除・控除後所得は続柄情報が必要なため
  // 利用者が e-Tax 上で補完する。
  put(out, tagByJa(PAGE1, '専従者控除前の所得金額'), whiteReturnAdjustedNetIncome(pl).toString());
  return out;
}