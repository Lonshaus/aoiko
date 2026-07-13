// aoiko 業務データ（PL / BS / 月別）→ KOA210（青色申告決算書 一般用）参照側
// 直接値 leaf（gen:kingaku 等）への対映。
//
// KOA210 は KOA020 と異なり、決算書の金額は IT部 IDREF ではなく要素テキストで
// 直接保持する（leaf.idref 無し）。本モジュールは schema（refTree）を走査して
// 「ページ × 日本語名 → leaf tag」を解決し、aoiko の勘定科目名で対応付ける。
// 対応する leaf が無い項目は出力しない（buildXtxDocument が整形式・整合を保証）。

import koa210 from './xtx-schema-koa210.generated.json';
import { D } from '../../lib/decimal';
import { computeDepreciation } from '../../domain/depreciation';
import { computeCombinedBusinessRealEstateIncome } from './real-estate-income';
import type { XtxSchema } from './xtx-schema';
import type { XtxContext } from './xtx';
import type { XtxLeafValues, XtxRepeatedValues } from './xtx-document';
import type { DepreciationMethod } from '../../db/types';

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
    if (e.kind === 'leaf' && !e.idref && e.refType === 'gen:kingaku' && page) {
      byPage.get(page)!.push({ tag: e.tag, ja: e.ja });
    }
  }
  return byPage;
}

const PAGES = kingakuLeavesByPage();
const PAGE1 = PAGES.get('KOA210-1') ?? []; // 損益計算書
const PAGE2 = PAGES.get('KOA210-2') ?? []; // 月別売上(仕入)金額
const PAGE4 = PAGES.get('KOA210-4') ?? []; // 貸借対照表
// BS の各科目は期首(AMG00040/00490)・期末(AMG00240/00620)の両ブランチに二重に存在し
// tagByJa の find は文書順最初＝期首を返す。期末残高は期末ブランチ配下の leaf に限定する。
function bsPeriodEndLeaves(): Leaf[] {
  const out: Leaf[] = [];
  let page = '';
  let period = '';
  for (const e of SCHEMA.refTree) {
    if (e.level === 1) {
      page = e.tag;
    }
    if (page !== 'KOA210-4') {
      continue;
    }
    if (e.kind === 'branch' && e.level <= 4) {
      period = e.ja === '期末' ? '期末' : e.ja === '期首' ? '期首' : '';
    }
    if (e.kind === 'leaf' && !e.idref && e.refType === 'gen:kingaku' && period === '期末') {
      out.push({ tag: e.tag, ja: e.ja });
    }
  }
  return out;
}
const PAGE4_END = bsPeriodEndLeaves();
// ページ内で日本語名が完全一致する最初の leaf tag を返す
function tagByJa(leaves: Leaf[], ja: string): string | undefined {
  return leaves.find((l) => l.ja === ja)?.tag;
}
// aoiko 勘定科目名 → KOA210 決算書 行名 の差異吸収
const BS_ALIAS: Record<string, string> = {
  普通預金: 'その他の預金',
  工具器具備品: '工具　器具　備品',
};
// 売上原価ブロック（AMF00120/00130/00150）の科目名差異吸収。KOA110 と同じ対映。
// 差引原価（AMF00160）は KOA110 も算出していないため、揃えて出力しない。
const EXPENSE_ALIAS: Record<string, string> = {
  期首商品棚卸高: '期首商品（製品）棚卸高',
  仕入: '仕入金額（製品製造原価）',
  期末商品棚卸高: '期末商品（製品）棚卸高',
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
    const ja = EXPENSE_ALIAS[row.accountName] ?? row.accountName;
    put(out, tagByJa(PAGE1, ja), row.amount);
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
    ctx.personalDeductions?.realEstateIncome,
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
  // 貸借対照表（ページ4）。aoiko は期首(繰越)残高を持たないため期末列のみ出力する（期首列は将来対応）。
  const bsLine = (accountName: string, amount: string) => {
    const ja = BS_ALIAS[accountName] ?? accountName;
    put(out, tagByJa(PAGE4_END, ja), amount);
    if (ja === '元入金') {
      // 手引き(一般用の書き方 p.6): 元入金は期首と期末に同じ金額を記入する。
      put(out, tagByJa(PAGE4, ja), amount);
    }
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
// 第3頁「減価償却費の計算」（AMF01590 → 明細 AMF01600、公式 xsd で maxOccurs=7）。
// KOA110（白色・AIM00010）/ KOA220（不動産・ANF00890）と同じく FixedAsset +
// computeDepreciation() から生成する。KOA210 は事業所得用のため incomeType が
// 'realEstate' の資産（KOA220 で出力済み）を除外する（未指定は 'business' 扱い）。
const MAX_DEPRECIATION_ROWS = 7;
const ASSET_NAME_MAX_LENGTH = 16;
const USEFUL_LIFE_MIN = 2;
const USEFUL_LIFE_MAX = 100;
// 事業専用割合（AMF01760）。aoiko は資産ごとの家事按分データを持たないため、
// 事業用資産は 100%（＝必要経費算入額 = 償却費）として出力する。
const BUSINESS_USE_RATIO = '100';
const DEPRECIATION_METHOD_LABEL: Record<DepreciationMethod, string> = {
  'straight-line': '定額法',
  'declining-balance': '定率法',
  'small-asset-special': '少額特例',
  'lump-sum': '一括償却',
};

function putRow(row: XtxLeafValues, tag: string, amount: string): void {
  const v = toKingaku(amount);
  if (v !== '') {
    row[tag] = v;
  }
}

export function mapKoa210RepeatedValues(ctx: XtxContext): XtxRepeatedValues {
  const detailYear = ctx.dataYear ?? ctx.year;
  const rows = ctx.fixedAssets
    .filter((a) => a.incomeType !== 'realEstate')
    .map((asset) => ({ asset, result: computeDepreciation(asset, detailYear) }))
    .filter(({ result }) => !D(result.amount).isZero())
    .sort((a, b) => a.asset.acquisitionDate.localeCompare(b.asset.acquisitionDate))
    .slice(0, MAX_DEPRECIATION_ROWS)
    .map(({ asset, result }) => {
      const row: XtxLeafValues = {};
      const name = asset.name.trim().slice(0, ASSET_NAME_MAX_LENGTH);
      if (name) {
        row.AMF01610 = name;
      }
      // AMF01630 取得年月（gen:yymm 複合型）は繰り返しブロックの単純文字列 leaf では
      // 表現できない（renderNode が値をエスケープするため生 XML を挿入不可）ため省略する。
      putRow(row, 'AMF01640', asset.acquisitionCost);
      row.AMF01660 = DEPRECIATION_METHOD_LABEL[asset.depreciationMethod];
      if (asset.usefulLifeYears >= USEFUL_LIFE_MIN && asset.usefulLifeYears <= USEFUL_LIFE_MAX) {
        row.AMF01670 = String(asset.usefulLifeYears);
      }
      putRow(row, 'AMF01730', result.amount);
      putRow(row, 'AMF01750', result.amount);
      row.AMF01760 = BUSINESS_USE_RATIO;
      putRow(row, 'AMF01770', result.amount);
      putRow(row, 'AMF01780', result.bookValueEnd);
      if (asset.disposedDate && Number(asset.disposedDate.slice(0, 4)) === detailYear) {
        row.AMF01790 = asset.disposalType === 'sale' ? '売却' : '除却';
      }
      return row;
    });
  return rows.length > 0 ? { AMF01600: rows } : {};
}
