// aoiko 業務データ（PL / BS / 月別）→ KOA210（青色申告決算書 一般用）参照側
// 直接値 leaf（gen:kingaku 等）への対映。
//
// KOA210 は KOA020 と異なり、決算書の金額は IT部 IDREF ではなく要素テキストで
// 直接保持する（leaf.idref 無し）。本モジュールは schema（refTree）を走査して
// 「ページ × 日本語名 → leaf tag」を解決し、aoiko の勘定科目名で対応付ける。
// 対応する leaf が無い項目は出力しない（buildXtxDocument が整形式・整合を保証）。

import koa210 from './xtx-schema-koa210.generated.json';
import { D } from '../../lib/decimal';
import { computeCombinedBusinessRealEstateIncome } from './real-estate-income';
import type { XtxSchema } from './xtx-schema';
import type { XtxContext } from './xtx';
import type { XtxLeafValues } from './xtx-document';

const SCHEMA = koa210 as XtxSchema;

interface Leaf {
  tag: string;
  ja: string;
}
// ページ（KOA210-1..4）ごとの gen:kingaku 直接値 leaf を出現順に収集
function kingakuLeavesByPage(): Map<string, Leaf[]> {
  const byPage = new Map<string, Leaf[]>();
  let page = '';
  for (const e of SCHEMA.refTree) {
    if (e.level === 1) {
      page = e.tag;
      byPage.set(page, []);
    }
    if (
      e.kind === 'leaf' &&
      !e.idref &&
      e.refType === 'gen:kingaku' &&
      page
    ) {
      byPage.get(page)!.push({ tag: e.tag, ja: e.ja });
    }
  }
  return byPage;
}

const PAGES = kingakuLeavesByPage();
const PAGE1 = PAGES.get('KOA210-1') ?? []; // 損益計算書
const PAGE2 = PAGES.get('KOA210-2') ?? []; // 月別売上(仕入)金額
const PAGE4 = PAGES.get('KOA210-4') ?? []; // 貸借対照表
// ページ内で日本語名が完全一致する最初の leaf tag を返す
function tagByJa(leaves: Leaf[], ja: string): string | undefined {
  return leaves.find((l) => l.ja === ja)?.tag;
}
// aoiko 勘定科目名 → KOA210 決算書 行名 の差異吸収
const BS_ALIAS: Record<string, string> = {
  普通預金: 'その他の預金',
  工具器具備品: '工具　器具　備品',
};
// gen:kingaku は xsd:long（整数・小数不可・先頭マイナス可）。
// Decimal 文字列を整数円へ（小数部切捨て、カンマ除去）
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

export function mapKoa210Values(ctx: XtxContext): XtxLeafValues {
  const { pl, bs, monthly } = ctx;
  const out: XtxLeafValues = {};
  // 損益計算書（ページ1）
  put(out, PAGE1[0]?.tag, pl.totalRevenue); // 売上（収入）金額（先頭）
  for (const row of pl.expense) {
    put(out, tagByJa(PAGE1, row.accountName), row.amount);
  }
  // 青色申告特別控除：控除前所得・控除額・控除後所得
  const preIncome = D(pl.netIncome);
  // 控除は不動産所得から先に充当し（措法25の2③）、44欄には事業への配分残額のみ入れる（二重計上防止）。
  const combined = computeCombinedBusinessRealEstateIncome(
    ctx.year,
    ctx.aoiroDeductionKind,
    preIncome.greaterThan(0),
    preIncome,
    ctx.realEstatePl,
    ctx.personalDeductions?.realEstateIncome
  );
  const deduction = preIncome.minus(combined.businessIncome);
  put(out, tagByJa(PAGE1, '青色申告特別控除前の所得金額(上段)'), pl.netIncome);
  put(out, tagByJa(PAGE1, '青色申告特別控除額'), deduction.toString());
  put(out, tagByJa(PAGE1, '所得金額'), preIncome.minus(deduction).toString());
  // 月別売上（収入）/ 仕入 金額（ページ2、先頭から 12 ヶ月分のペア）。
  // 仕入欄には経費合計ではなく仕入(売上原価)のみ（mo.purchases）を入れる。
  const sales = PAGE2.filter((l) => l.ja === '売上（収入）金額').slice(0, 12);
  const shiire = PAGE2.filter((l) => l.ja === '仕入金額').slice(0, 12);
  monthly.months.slice(0, 12).forEach((mo, i) => {
    put(out, sales[i]?.tag, mo.sales);
    put(out, shiire[i]?.tag, mo.purchases);
  });
  // 貸借対照表（ページ4、期末）
  const bsLine = (accountName: string, amount: string) => {
    const ja = BS_ALIAS[accountName] ?? accountName;
    put(out, tagByJa(PAGE4, ja), amount);
  };
  for (const r of bs.assets) {
    bsLine(r.accountName, r.balance);
  }
  for (const r of bs.liabilities) {
    bsLine(r.accountName, r.balance);
  }
  for (const r of bs.equity) {
    bsLine(r.accountName, r.balance);
  }

  return out;
}