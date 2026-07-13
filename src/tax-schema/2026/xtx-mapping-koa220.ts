// aoiko 業務データ（不動産所得PL・FixedAsset・personalDeductions.realEstateIncome）
// → KOA220（青色申告決算書・不動産所得用）参照側 直接値 leaf への対映。
//
// KOA210 と同じく決算書の金額は要素テキストで直接保持する（leaf.idref 無し）。
// 第2頁（貸家等の状況・給料賃金・専従者給与の内訳）・第3頁（減価償却・地代家賃・
// 借入金利子・税理士等報酬）・第4頁（貸借対照表）は繰り返しブロック（XtxRepeatedValues）
// で表現する。
//
// KOA220 には貸倒金・貸倒引当金繰入額の専用欄が無いため、EXPENSE_ALIAS 未対応の
// 不動産経費科目は「追加科目　繰り返し」（ANF00195、上限5）へ出力する
// （additionalExpenseRows 参照）。
//
// 対応しない項目（対応不可分・低優先度、e-Tax 上で利用者が補完）：
//  - 給料賃金の内訳（ANF00620、専従者以外の使用人の内訳）：不動産所得で使用人を
//    雇うのは稀なケースのため対象外
//  - 専従者給与の内訳（ANF00780、氏名・続柄等）：aoiko は続柄データを持たないため
//    事業所得側と同じ方針で出力しない。専従者給与の「金額」自体は第1頁の
//    必要経費（専従者給与）に含まれる
//  - 貸借対照表（ANG00000、第4頁）：不動産所得単独の貸借対照表は現状 aoiko の
//    BS 計算対象外（事業所得の BS と分離した集計が必要なため）。将来対応

import koa220 from './xtx-schema-koa220.generated.json';
import { D } from '../../lib/decimal';
import type { XtxSchema } from './xtx-schema';
import type { XtxContext } from './xtx';
import type { XtxLeafValues, XtxRepeatedValues } from './xtx-document';
import type { DepreciationMethod } from '../../db/types';
import { computeDepreciation } from '../../domain/depreciation';
import {
  computeCombinedBusinessRealEstateIncome,
  realEstatePreDeductionIncome,
} from './real-estate-income';

const SCHEMA = koa220 as XtxSchema;

interface Leaf {
  tag: string;
  ja: string;
}
// ページ（KOA220-1..4）ごとの gen:kingaku 直接値 leaf を出現順に収集
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
const PAGE1 = PAGES.get('KOA220-1') ?? []; // 損益計算書
// ページ内で日本語名が完全一致する最初の leaf tag を返す
function tagByJa(leaves: Leaf[], ja: string): string | undefined {
  return leaves.find((l) => l.ja === ja)?.tag;
}
// aoiko 勘定科目名（不動産用、末尾「（不動産）」）→ KOA220 決算書 行名 の差異吸収
const EXPENSE_ALIAS: Record<string, string> = {
  '租税公課（不動産）': '租税公課',
  '損害保険料（不動産）': '損害保険料',
  '修繕費（不動産）': '修繕費',
  '減価償却費（不動産）': '減価償却費',
  '借入金利子（不動産）': '借入金利子',
  '地代家賃（不動産）': '地代家賃',
  '給料賃金（不動産）': '給料賃金',
  '雑費（不動産）': 'その他の経費',
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

function put(out: XtxLeafValues, tag: string | undefined, amount: string): void {
  if (!tag) {
    return;
  }
  const v = toKingaku(amount);
  if (v !== '') {
    out[tag] = v;
  }
}

export function mapKoa220Values(ctx: XtxContext): XtxLeafValues {
  const out: XtxLeafValues = {};
  const pl = ctx.realEstatePl;
  if (!pl) {
    return out;
  }
  put(
    out,
    tagByJa(PAGE1, '賃貸料'),
    pl.revenue.find((r) => r.accountName === '賃貸料（不動産）')?.amount ?? '0',
  );
  put(
    out,
    tagByJa(PAGE1, '礼金・権利金・更新料'),
    pl.revenue.find((r) => r.accountName === '礼金・権利金等（不動産）')?.amount ?? '0',
  );
  // 賃貸料・礼金以外の不動産収入（雑収入（不動産）等）は追加科目欄（科目名 ANF00050・
  // 金額 ANF00100）へ集約する。第1頁の収入欄は追加科目が1行のため合算する
  const customRevenue = pl.revenue.filter(
    (r) => r.accountName !== '賃貸料（不動産）' && r.accountName !== '礼金・権利金等（不動産）',
  );
  if (customRevenue.length > 0) {
    const customAmount = customRevenue.reduce((sum, r) => sum.plus(D(r.amount)), D(0));
    out.ANF00050 = customRevenue[0]!.accountName.replace('（不動産）', '').slice(0, 10);
    put(out, tagByJa(PAGE1, '追加科目の金額'), customAmount.toString());
  }
  for (const row of pl.expense) {
    const ja = EXPENSE_ALIAS[row.accountName];
    if (!ja) {
      continue;
    }
    put(out, tagByJa(PAGE1, ja), row.amount);
  }
  const realEstateInput = ctx.personalDeductions?.realEstateIncome;
  const businessScale = realEstateInput?.businessScale ?? false;
  const preDeductionIncome = realEstatePreDeductionIncome(pl, businessScale);
  put(out, tagByJa(PAGE1, '差引金額'), preDeductionIncome.toString());
  const businessPreIncome = D(ctx.pl.netIncome);
  const combined = computeCombinedBusinessRealEstateIncome(
    ctx.year,
    ctx.aoiroDeductionKind,
    businessPreIncome.greaterThan(0),
    businessPreIncome,
    pl,
    realEstateInput,
  );
  const deduction = preDeductionIncome.minus(combined.realEstateIncomeAfterDeduction);
  put(out, tagByJa(PAGE1, '青色申告特別控除前の所得金額(上段)'), preDeductionIncome.toString());
  put(out, tagByJa(PAGE1, '青色申告特別控除額'), deduction.toString());
  put(out, tagByJa(PAGE1, '所得金額'), combined.realEstateIncomeAfterDeduction.toString());
  if (realEstateInput?.landLoanInterestAmount) {
    put(
      out,
      tagByJa(PAGE1, '土地等を取得するために要した負債の利子の額'),
      realEstateInput.landLoanInterestAmount.toString(),
    );
  }
  return out;
}

const ASSET_NAME_MAX_LENGTH = 16;
const USEFUL_LIFE_MIN = 2;
const USEFUL_LIFE_MAX = 100;
const DEPRECIATION_METHOD_LABEL: Record<DepreciationMethod, string> = {
  'straight-line': '定額法',
  'declining-balance': '定率法',
  'small-asset-special': '少額特例',
  'lump-sum': '一括償却',
};
// 各繰り返しブロックの公式 maxOccurs（実際の xsd 上限）
const MAX_PROPERTY_ROWS = 15;
const MAX_DEPRECIATION_ROWS = 13;
const MAX_RENT_PAID_ROWS = 2;
const MAX_LOAN_INTEREST_PAID_ROWS = 3;
const MAX_PROFESSIONAL_FEE_ROWS = 2;
const MAX_ADDITIONAL_EXPENSE_ROWS = 5;
const ADDITIONAL_EXPENSE_NAME_MAX_LENGTH = 10;

function putRow(row: XtxLeafValues, tag: string, amount: string): void {
  const v = toKingaku(amount);
  if (v !== '') {
    row[tag] = v;
  }
}

// 第2頁「貸家等の状況」（ANF00340）。incomeType: 'realEstate' の FixedAsset の
// realEstateDetail から生成する（物件＝資産という1:1の単純化、複数棟をまたぐ
// 按分等は対象外）。
function propertyRows(ctx: XtxContext): XtxLeafValues[] {
  return ctx.fixedAssets
    .filter((a) => a.incomeType === 'realEstate' && a.realEstateDetail)
    .slice(0, MAX_PROPERTY_ROWS)
    .map((a) => {
      const d = a.realEstateDetail!;
      const row: XtxLeafValues = {};
      row.ANF00350 = d.propertyType.slice(0, 10);
      row.ANF00355 = d.isResidential === false ? '住宅用以外' : '住宅用';
      row.ANF00360 = d.address;
      if (d.tenantAddress) {
        row.ANF00380 = d.tenantAddress;
      }
      if (d.tenantName) {
        row.ANF00390 = d.tenantName;
      }
      if (d.rentalPeriodStart) {
        row.ANF00410 = d.rentalPeriodStart;
      }
      if (d.rentalPeriodEnd) {
        row.ANF00420 = d.rentalPeriodEnd;
      }
      if (d.areaSqm) {
        putRow(row, 'ANF00430', d.areaSqm);
      }
      putRow(row, 'ANF00500', d.annualRent);
      if (d.keyMoneyEtc) {
        putRow(row, 'ANF00510', d.keyMoneyEtc);
      }
      if (d.otherIncome) {
        putRow(row, 'ANF00540', d.otherIncome);
      }
      if (d.depositBalance) {
        putRow(row, 'ANF00550', d.depositBalance);
      }
      return row;
    });
}

// 第3頁「減価償却費の計算」（ANF00890）。incomeType: 'realEstate' の FixedAsset のみ、
// 事業所得側（xtx-mapping-koa110.ts の mapKoa110RepeatedValues）と同じロジックを使う。
function depreciationRows(ctx: XtxContext): XtxLeafValues[] {
  return ctx.fixedAssets
    .filter((a) => a.incomeType === 'realEstate')
    .map((asset) => ({ asset, result: computeDepreciation(asset, ctx.year) }))
    .filter(({ result }) => !D(result.amount).isZero())
    .sort((a, b) => a.asset.acquisitionDate.localeCompare(b.asset.acquisitionDate))
    .slice(0, MAX_DEPRECIATION_ROWS)
    .map(({ asset, result }) => {
      const row: XtxLeafValues = {};
      const name = asset.name.trim().slice(0, ASSET_NAME_MAX_LENGTH);
      if (name) {
        row.ANF00900 = name;
      }
      putRow(row, 'ANF00930', asset.acquisitionCost);
      putRow(row, 'ANF00940', asset.acquisitionCost);
      row.ANF00950 = DEPRECIATION_METHOD_LABEL[asset.depreciationMethod];
      if (asset.usefulLifeYears >= USEFUL_LIFE_MIN && asset.usefulLifeYears <= USEFUL_LIFE_MAX) {
        row.ANF00960 = String(asset.usefulLifeYears);
      }
      putRow(row, 'ANF01020', result.amount);
      putRow(row, 'ANF01040', result.amount);
      putRow(row, 'ANF01060', result.amount);
      putRow(row, 'ANF01070', result.bookValueEnd);
      if (asset.disposedDate && Number(asset.disposedDate.slice(0, 4)) === ctx.year) {
        row.ANF01080 = asset.disposalType === 'sale' ? '売却' : '除却';
      }
      return row;
    });
}

function payeeRows<
  T extends {
    payeeAddress?: string;
    payeeName?: string;
    amount: string;
    deductibleAmount?: string;
  },
>(
  items: T[] | undefined,
  max: number,
  addressTag: string,
  nameTag: string,
  amountTag: string,
  deductibleTag: string,
  extra?: (row: XtxLeafValues, item: T) => void,
): XtxLeafValues[] {
  return (items ?? []).slice(0, max).map((item) => {
    const row: XtxLeafValues = {};
    if (item.payeeAddress) {
      row[addressTag] = item.payeeAddress;
    }
    if (item.payeeName) {
      row[nameTag] = item.payeeName;
    }
    putRow(row, amountTag, item.amount);
    if (item.deductibleAmount) {
      putRow(row, deductibleTag, item.deductibleAmount);
    }
    extra?.(row, item);
    return row;
  });
}

// KOA220 第1頁の必要経費区分（EXPENSE_ALIAS）に専用欄が無い科目（例：貸倒金（不動産）・
// 貸倒引当金繰入額（不動産））を「追加科目　繰り返し」（ANF00195、上限5・科目名10文字）
// へ出力する。5件を超える分は出力しない（超過時は e-Tax 上で利用者が手動補完）。
function additionalExpenseRows(ctx: XtxContext): XtxLeafValues[] {
  const pl = ctx.realEstatePl;
  if (!pl) {
    return [];
  }
  return pl.expense
    .filter((row) => !(row.accountName in EXPENSE_ALIAS))
    .slice(0, MAX_ADDITIONAL_EXPENSE_ROWS)
    .map((row) => {
      const name = row.accountName
        .replace('（不動産）', '')
        .slice(0, ADDITIONAL_EXPENSE_NAME_MAX_LENGTH);
      const item: XtxLeafValues = { ANF00060: name };
      putRow(item, 'ANF00200', row.amount);
      return item;
    });
}

export function mapKoa220RepeatedValues(ctx: XtxContext): XtxRepeatedValues {
  const out: XtxRepeatedValues = {};
  const properties = propertyRows(ctx);
  if (properties.length > 0) {
    out.ANF00340 = properties;
  }
  const additionalExpenses = additionalExpenseRows(ctx);
  if (additionalExpenses.length > 0) {
    out.ANF00195 = additionalExpenses;
  }
  const depreciation = depreciationRows(ctx);
  if (depreciation.length > 0) {
    out.ANF00890 = depreciation;
  }
  const realEstateInput = ctx.personalDeductions?.realEstateIncome;
  const rentPaid = payeeRows(
    realEstateInput?.rentPaid,
    MAX_RENT_PAID_ROWS,
    'ANF01180',
    'ANF01190',
    'ANF01240',
    'ANF01250',
  );
  if (rentPaid.length > 0) {
    out.ANF01160 = rentPaid;
  }
  const loanInterestPaid = payeeRows(
    realEstateInput?.loanInterestPaid,
    MAX_LOAN_INTEREST_PAID_ROWS,
    'ANF01280',
    'ANF01290',
    'ANF01310',
    'ANF01320',
    (row, item) => {
      if (item.yearEndBalance) {
        putRow(row, 'ANF01300', item.yearEndBalance);
      }
    },
  );
  if (loanInterestPaid.length > 0) {
    out.ANF01260 = loanInterestPaid;
  }
  const professionalFeesPaid = payeeRows(
    realEstateInput?.professionalFeesPaid,
    MAX_PROFESSIONAL_FEE_ROWS,
    'ANF01350',
    'ANF01360',
    'ANF01370',
    'ANF01380',
    (row, item) => {
      if (item.withholdingTax) {
        putRow(row, 'ANF01390', item.withholdingTax);
      }
    },
  );
  if (professionalFeesPaid.length > 0) {
    out.ANF01330 = professionalFeesPaid;
  }
  return out;
}
