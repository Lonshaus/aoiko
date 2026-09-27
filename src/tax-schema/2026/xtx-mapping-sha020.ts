// aoiko 業務データ（消費税集計）→ SHA020（消費税及び地方消費税の申告書・簡易課税用）
// の値マップ。2 つの申告方式を扱う：
//  - mapTwoWari()：2割特例（+ SHB070 付表6）
//  - mapSimplified()：簡易課税（設定区分＋印の付いた行の第四種の 2 区分まで、+ SHB047 付表4-3、SHB067 付表5-3）
//
// 2割特例は「簡易課税を正式に選択していない事業者も SHA020 の様式構造を使う」運用
// （国税庁「２割特例用 消費税及び地方消費税の確定申告の手引き」の設例で確認済み）。
// ABY00000「税額控除に係る経過措置の適用（２割特例）」を raw（kubun_CD=1）で立てる。
//
// 対応していない項目（簡略化・既知の限界）：
//  - 付表4-3 DUF00060（簡易課税の課税標準額計算表の内訳）：aoiko の集計は返品・値引を
//    課税標準額へネットで反映済みのため、内訳を分離して転記しない（最終税額は正しいが、
//    明細としての内訳表示にはならない）。2割特例の付表6・SHA020は mapTwoWari の
//    salesReturnTax78/624 で内訳表示に対応済み
//  - 基準期間の課税売上高等、2割特例では「記載不要」とされる事業区分欄は出力しない
//  - 簡易課税は設定区分＋印の付いた行（taxableTransferConsideration、消基通13-2-9で第四種）の
//    2区分の兼業まで対応（付表5-3 二面）。3区分以上の按分は未対応（aoiko の設定は
//    単一の事業区分のみを持つ前提、[07. 消費税] マニュアル参照）
//  - 控除超過還付（簡易課税で貸倒れ税額が控除税額小計を上回る等）は差引税額（ABI00100）へ
//    負値を書かず、控除不足還付税額欄（国税 ABI00090・地方 ABJ00020/ABJ00050）へ正値で出力する。
//    中間納付の充当は差引税額（納付側）に対してのみ行い、ABJ00130 は符号付き純額（負＝還付）

import { D, Decimal } from '../../lib/decimal';
import {
  computeOfficialOutputTax,
  computeSimplifiedCategoryDeduction,
  filingBreakdown,
  type OfficialOutputTax,
} from '../../domain/consumption-tax';
import type { SimplifiedTaxCategory } from './simplified-tax';
import { toYymmdd, type XtxLeafValues, type XtxRawValues } from './xtx-document';
// gen:kingaku は xsd:long（整数円）。Decimal → 整数円文字列（カンマ無し、先頭ゼロ除去）
function toKingaku(value: Decimal): string {
  const rounded = value.toDecimalPlaces(0, Decimal.ROUND_DOWN);
  if (rounded.isZero()) {
    return '0';
  }
  return rounded.toString();
}

function put(out: XtxLeafValues, tag: string, value: Decimal): void {
  const v = toKingaku(value);
  if (v !== '0') {
    out[tag] = v;
  }
}
// 差引が正なら差引欄（dueTag）、負なら還付欄（refundTag）へ絶対値を書き込む。
// 消費税申告書は控除超過による還付を差引税額の負値ではなく、専用の控除不足還付税額欄に
// 正値で記載する（簡易課税では貸倒れ税額が控除税額小計を超えると差引が負になり得る）。
function putSigned(out: XtxLeafValues, dueTag: string, refundTag: string, value: Decimal): void {
  if (value.isNegative()) {
    put(out, refundTag, value.negated());
  } else {
    put(out, dueTag, value);
  }
}
// 差引税額（base）から本年中の中間納付額（paid）を充当した結果を返す。
// paid が base を超える場合は還付（ABI00130/ABJ00090 系）扱いとする。
function applyInterimCredit(base: Decimal, paid: Decimal): { due: Decimal; refund: Decimal } {
  const diff = base.minus(paid);
  return diff.isNegative() ? { due: D(0), refund: diff.negated() } : { due: diff, refund: D(0) };
}
// SHA020 第一表・第二表は 2 割特例・簡易課税で同じ構造（控除対象仕入税額の
// 算定方法だけが異なる）。控除額が決まった後の転記部分を共通化する。
// 貸倒れ税額・貸倒回収は消費税法39条によりどちらの方式でも同じ扱い：
// 貸倒回収は消費税額に加算、貸倒れは控除税額小計に含めて減算する。
function buildSha020Common(
  official: OfficialOutputTax,
  creditTotal: Decimal,
  badDebtTax: Decimal,
  badDebtRecoveryTax: Decimal,
  interimPaidNational: Decimal,
  interimPaidLocal: Decimal,
  returnTax: Decimal = D(0),
): XtxLeafValues {
  // 控除税額小計（ABI00080）＝控除対象仕入税額（ABI00050）＋返還等対価に係る税額（ABI00060）
  // ＋貸倒れに係る税額（ABI00070）
  const creditSubtotal = creditTotal.plus(returnTax).plus(badDebtTax);
  const nationalNetRaw = official.outputTax.plus(badDebtRecoveryTax).minus(creditSubtotal);
  const filing = filingBreakdown(nationalNetRaw);
  const filingNational = D(filing.national);
  const filingLocal = D(filing.local);

  const sha020: XtxLeafValues = {};
  put(sha020, 'ABI00010', official.taxableBase);
  put(sha020, 'ABI00020', official.outputTax);
  put(sha020, 'ABI00030', badDebtRecoveryTax);
  put(sha020, 'ABI00050', creditTotal);
  put(sha020, 'ABI00060', returnTax);
  put(sha020, 'ABI00070', badDebtTax);
  put(sha020, 'ABI00080', creditSubtotal);
  putSigned(sha020, 'ABI00100', 'ABI00090', filingNational);
  putSigned(sha020, 'ABJ00030', 'ABJ00020', filingNational);
  putSigned(sha020, 'ABJ00060', 'ABJ00050', filingLocal);
  // 中間納付の充当は差引税額（納付側）に対してのみ行う。控除不足還付（差引が負）の
  // 場合は差引税額が無く、中間納付額はその全額が中間納付還付税額となる。
  const nationalDue = filingNational.isNegative() ? D(0) : filingNational;
  const localDue = filingLocal.isNegative() ? D(0) : filingLocal;
  const national = applyInterimCredit(nationalDue, interimPaidNational);
  const local = applyInterimCredit(localDue, interimPaidLocal);
  if (interimPaidNational.greaterThan(0)) {
    put(sha020, 'ABI00110', interimPaidNational);
    if (national.refund.greaterThan(0)) {
      put(sha020, 'ABI00130', national.refund);
    } else {
      put(sha020, 'ABI00120', national.due);
    }
  } else {
    put(sha020, 'ABI00120', nationalDue);
  }
  if (interimPaidLocal.greaterThan(0)) {
    put(sha020, 'ABJ00070', interimPaidLocal);
    if (local.refund.greaterThan(0)) {
      put(sha020, 'ABJ00090', local.refund);
    } else {
      put(sha020, 'ABJ00080', local.due);
    }
  } else {
    put(sha020, 'ABJ00080', localDue);
  }
  // 合計（納付又は還付）税額：控除不足還付・中間納付還付を含む符号付き純額
  // （正＝納付、負＝還付）。控除不足還付分は差引税額(filing)の負値に含まれる。
  put(
    sha020,
    'ABJ00130',
    filingNational.minus(interimPaidNational).plus(filingLocal).minus(interimPaidLocal),
  );
  // 第二表（内訳）：軽減税率のみの利用者が多い想定だが、両税率とも同じ値を転記
  put(sha020, 'ABO00000', official.taxableBase);
  put(sha020, 'ABP00040', official.base8);
  put(sha020, 'ABP00050', official.base10);
  put(sha020, 'ABP00060', official.taxableBase);
  put(sha020, 'ABR00000', official.outputTax);
  put(sha020, 'ABS00040', official.tax8);
  put(sha020, 'ABS00050', official.tax10);
  // 2割特例・簡易課税は特定課税仕入れを「なかったもの」とするため、返還等対価に係る税額は
  // 常に売上げ分（ABU00010）のみで、特定課税仕入れ分（ABU00020）は生じない
  put(sha020, 'ABT00000', returnTax);
  put(sha020, 'ABU00010', returnTax);
  put(sha020, 'ABV00010', filingNational);
  put(sha020, 'ABV00040', filingNational);
  return sha020;
}
// 中間申告（仮決算方式）の対象期間を ABH00160 の raw XML に変換する（未指定なら undefined）。
function buildInterimPeriodRaw(period?: { start: string; end: string }): string | undefined {
  if (!period) {
    return undefined;
  }
  return (
    `<ABH00170>${toYymmdd(period.start)}</ABH00170>` +
    `<ABH00180>${toYymmdd(period.end)}</ABH00180>`
  );
}

interface TwoWariMappingInput {
  /** 課税資産の譲渡等の対価の額（税抜、標準税率10%＝国税7.8%分）。返品・値引ネット後 */
  taxableBase10: Decimal;
  /** 課税資産の譲渡等の対価の額（税抜、軽減税率8%＝国税6.24%分）。返品・値引ネット後 */
  taxableBase8: Decimal;
  /** 貸倒れに係る税額（税率別） */
  badDebtTax10: Decimal;
  badDebtTax8: Decimal;
  /** 貸倒回収に係る消費税額（税率別） */
  badDebtRecoveryTax10: Decimal;
  badDebtRecoveryTax8: Decimal;
  /** 売上対価の返還等に係る消費税額（税率別、未相殺の分のみ）。附則51条の2第2項 */
  salesReturnTax78?: Decimal;
  salesReturnTax624?: Decimal;
  /** 本年中に中間納付した消費税額（国税分）。確定申告の差引税額から充当する */
  interimPaidNational?: Decimal;
  /** 本年中に中間納付した地方消費税額（譲渡割額）。確定申告の差引税額から充当する */
  interimPaidLocal?: Decimal;
}

interface TwoWariMapping {
  /** SHA020（申告書）第一表・第二表の直接値 leaf */
  sha020: XtxLeafValues;
  /** SHA020 の区分（kubun）ブランチ上書き：2割特例チェック欄 */
  sha020Raw: XtxRawValues;
  /** SHB070（付表6）の直接値 leaf */
  shb070: XtxLeafValues;
}
// 2割特例（措法57の2）：付表6 で特別控除税額（控除対象仕入税額とみなす額）を算定し、
// SHA020 に転記する。国税庁「２割特例用 確定申告の手引き」の計算手順（Step1〜6）に対応：
//  Step1 課税売上げ(税抜) → taxableBase10/8（呼出元で税抜・返品ネット済みの値を渡す）
//  Step2 課税標準額 = 税率ごとに千円未満切り捨て
//  Step3 消費税額 = 課税標準額 × 7.8%/6.24%（税率ごとに1円未満切り捨て）
//  Step4 返還等対価に係る税額（未相殺分。呼出元が税率別に渡す。附則51条の2第2項）
//  Step4.5 貸倒回収に係る消費税額を加算（消費税法39条は2割特例にも適用）
//  Step5 控除対象仕入税額の計算の基礎となる消費税額 = Step3 − Step4 ＋ 貸倒回収
//  Step6 特別控除税額 = Step5 × 80%（1円未満切り捨て）
//  貸倒れに係る税額は特別控除税額とは別枠で、最終税額の計算時に減算する（AYD）
export function mapTwoWari(input: TwoWariMappingInput): TwoWariMapping {
  const official = computeOfficialOutputTax(input.taxableBase10, input.taxableBase8);
  const returnTax78 = input.salesReturnTax78 ?? D(0);
  const returnTax624 = input.salesReturnTax624 ?? D(0);
  const returnTaxTotal = returnTax78.plus(returnTax624);
  const basicBase8 = official.tax8.plus(input.badDebtRecoveryTax8).minus(returnTax624);
  const basicBase10 = official.tax10.plus(input.badDebtRecoveryTax10).minus(returnTax78);
  const specialDeduction8 = basicBase8.times('0.8').toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const specialDeduction10 = basicBase10.times('0.8').toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const specialDeductionTotal = specialDeduction8.plus(specialDeduction10);
  const badDebtTaxTotal = input.badDebtTax8.plus(input.badDebtTax10);
  const badDebtRecoveryTaxTotal = input.badDebtRecoveryTax8.plus(input.badDebtRecoveryTax10);

  const shb070: XtxLeafValues = {};
  put(shb070, 'AYB00020', input.taxableBase8);
  put(shb070, 'AYB00030', input.taxableBase10);
  put(shb070, 'AYB00040', input.taxableBase8.plus(input.taxableBase10));
  put(shb070, 'AYB00060', official.base8);
  put(shb070, 'AYB00070', official.base10);
  put(shb070, 'AYB00080', official.taxableBase);
  put(shb070, 'AYB00100', official.tax8);
  put(shb070, 'AYB00110', official.tax10);
  put(shb070, 'AYB00120', official.outputTax);
  put(shb070, 'AYB00140', input.badDebtRecoveryTax8);
  put(shb070, 'AYB00150', input.badDebtRecoveryTax10);
  put(shb070, 'AYB00160', badDebtRecoveryTaxTotal);
  put(shb070, 'AYB00180', returnTax624);
  put(shb070, 'AYB00190', returnTax78);
  put(shb070, 'AYB00200', returnTaxTotal);
  put(shb070, 'AYB00220', basicBase8);
  put(shb070, 'AYB00230', basicBase10);
  put(shb070, 'AYB00240', basicBase8.plus(basicBase10));
  put(shb070, 'AYC00020', specialDeduction8);
  put(shb070, 'AYC00030', specialDeduction10);
  put(shb070, 'AYC00040', specialDeductionTotal);
  put(shb070, 'AYD00020', input.badDebtTax8);
  put(shb070, 'AYD00030', input.badDebtTax10);
  put(shb070, 'AYD00040', badDebtTaxTotal);

  const sha020 = buildSha020Common(
    official,
    specialDeductionTotal,
    badDebtTaxTotal,
    badDebtRecoveryTaxTotal,
    input.interimPaidNational ?? D(0),
    input.interimPaidLocal ?? D(0),
    returnTaxTotal,
  );
  const sha020Raw: XtxRawValues = { ABY00000: '<kubun_CD>1</kubun_CD>' };

  return {
    sha020,
    sha020Raw,
    shb070,
  };
}

interface SimplifiedMappingInput {
  /** 課税資産の譲渡等の対価の額（税抜、標準税率10%＝国税7.8%分）。返品・値引ネット後 */
  taxableBase10: Decimal;
  /** 課税資産の譲渡等の対価の額（税抜、軽減税率8%＝国税6.24%分）。返品・値引ネット後 */
  taxableBase8: Decimal;
  /** 設定した事業区分（第1種〜第6種）。印の付いた行の第四種分は markedTransferBase10/8 で別に渡す */
  category: SimplifiedTaxCategory;
  /** みなし仕入率（第1種90%〜第6種40%）。simplified-tax.ts の deemedInputRate() の結果を渡す */
  deemedInputRate: number;
  /** 貸倒れに係る税額（税率別） */
  badDebtTax10: Decimal;
  badDebtTax8: Decimal;
  /** 貸倒回収に係る消費税額（税率別） */
  badDebtRecoveryTax10: Decimal;
  badDebtRecoveryTax8: Decimal;
  /** taxableTransferConsideration の印の付いた行（消基通13-2-9で第四種）分の課税標準額
   * （税抜、税率別）。無ければ単一区分の従来計算のまま（既存データ不変） */
  markedTransferBase10?: Decimal;
  markedTransferBase8?: Decimal;
  /** 中間申告（仮決算方式）の対象期間。指定時は ABH00160 に転記する */
  interimPeriod?: { start: string; end: string };
  /** 本年中に中間納付した消費税額（国税分）。確定申告の差引税額から充当する */
  interimPaidNational?: Decimal;
  /** 本年中に中間納付した地方消費税額（譲渡割額）。確定申告の差引税額から充当する */
  interimPaidLocal?: Decimal;
}

interface SimplifiedMapping {
  /** SHA020（申告書）第一表・第二表の直接値 leaf */
  sha020: XtxLeafValues;
  /** SHA020 の区分（kubun）ブランチ上書き：中間申告の対象期間 */
  sha020Raw: XtxRawValues;
  /** 付表4-3（税率別消費税額計算表兼地方消費税の課税標準となる消費税額計算表） */
  shb047: XtxLeafValues;
  /** 付表5-3（控除対象仕入税額等の計算表）の直接値 leaf */
  shb067: XtxLeafValues;
  /** 付表5-3 の区分（kubun）ブランチ上書き：事業区分チェック欄 */
  shb067Raw: XtxRawValues;
}

const CATEGORY_TAXABLE_SALES_TAG: Record<SimplifiedTaxCategory, string> = {
  1: 'ABL00040',
  2: 'ABL00070',
  3: 'ABL00100',
  4: 'ABL00130',
  5: 'ABL00160',
  6: 'ABL00190',
};
// 付表5-3 (2)「事業区分別の課税売上高に係る消費税額の明細」の区分別ヘッダー番号
// （+10=税率6.24%適用分、+20=税率7.8%適用分、+30=合計）
const CATEGORY_DVD_DETAIL_TAG: Record<SimplifiedTaxCategory, number> = {
  1: 470,
  2: 510,
  3: 550,
  4: 590,
  5: 630,
  6: 670,
};
function tagNum(n: number): string {
  return `DVD${String(n).padStart(5, '0')}`;
}
// 付表5-3 (1)「事業区分別の課税売上高（税抜き）の明細」の区分別ヘッダー番号
// （+10=税率6.24%適用分、+20=税率7.8%適用分、+30=合計（branch。値は+40）、+40=金額、
// +50=売上割合）。「合計」欄は分岐で、実際の金額は配下の「金額」leaf に入る
// （xtx-schema-shb067.generated.json のレベル構造で確認済み）
const CATEGORY_DVD_SALES_TAG: Record<SimplifiedTaxCategory, number> = {
  1: 60,
  2: 120,
  3: 180,
  4: 240,
  5: 300,
  6: 360,
};
// 売上割合（%）を小数点1桁未満切り捨てで算定する（ABL00050等・DVD00110等の型が
// 0〜100・小数1桁までしか許さないため。国税庁「法人用書き方」設例のとおり四捨五入ではなく
// 切り捨て：16,463,299÷16,717,844×100＝98.477…%を「98.4%」と記載）
function floorPercent(numerator: Decimal, denominator: Decimal): string {
  if (denominator.isZero()) {
    return '0';
  }
  return numerator
    .dividedBy(denominator)
    .times(100)
    .toDecimalPlaces(1, Decimal.ROUND_DOWN)
    .toString();
}
// 簡易課税：控除対象仕入税額 = (課税標準額に対する消費税額＋貸倒回収) × みなし仕入率
// （基準消費税額に貸倒回収を算入するのは国税庁「簡易課税用申告の手引き」どおり）。
// 貸倒れに係る税額はみなし仕入率の計算とは別枠で、最終税額の計算時に減算する。
// markedTransferBase10/8（taxableTransferConsideration の印の付いた行、消基通13-2-9で第四種）が
// 有る場合は施行令57条2項・3項の兼業計算（原則・75%特例のうち大きい方）に切り替える。
// aoiko の事業区分入力は単一（設定区分）のみのため、対応する兼業は「設定区分＋第四種」
// の2区分に限る（3区分以上の按分は未対応）。
export function mapSimplified(input: SimplifiedMappingInput): SimplifiedMapping {
  const official = computeOfficialOutputTax(input.taxableBase10, input.taxableBase8);
  const basicBase8 = official.tax8.plus(input.badDebtRecoveryTax8);
  const basicBase10 = official.tax10.plus(input.badDebtRecoveryTax10);
  const markedBase10 = input.markedTransferBase10 ?? D(0);
  const markedBase8 = input.markedTransferBase8 ?? D(0);
  const hasMarkedTransfer = !markedBase10.isZero() || !markedBase8.isZero();
  const officialMarked = computeOfficialOutputTax(markedBase10, markedBase8);
  const mainTaxOnly8 = official.tax8.minus(officialMarked.tax8);
  const mainTaxOnly10 = official.tax10.minus(officialMarked.tax10);
  const mainTax8 = mainTaxOnly8.plus(input.badDebtRecoveryTax8);
  const mainTax10 = mainTaxOnly10.plus(input.badDebtRecoveryTax10);
  const categorySplit = hasMarkedTransfer
    ? computeSimplifiedCategoryDeduction(
        input.category,
        mainTax10,
        mainTax8,
        officialMarked.tax10,
        officialMarked.tax8,
      )
    : undefined;
  const deemedInput8 = categorySplit
    ? categorySplit.deduction8
    : basicBase8.times(input.deemedInputRate).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const deemedInput10 = categorySplit
    ? categorySplit.deduction10
    : basicBase10.times(input.deemedInputRate).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const deemedInputTotal = deemedInput8.plus(deemedInput10);
  const badDebtTaxTotal = input.badDebtTax8.plus(input.badDebtTax10);
  const badDebtRecoveryTaxTotal = input.badDebtRecoveryTax8.plus(input.badDebtRecoveryTax10);

  const shb047: XtxLeafValues = {};
  put(shb047, 'DUB00010', official.base8);
  put(shb047, 'DUB00020', official.base10);
  put(shb047, 'DUB00030', official.taxableBase);
  put(shb047, 'DUC00010', input.taxableBase8);
  put(shb047, 'DUC00020', input.taxableBase10);
  put(shb047, 'DUC00030', input.taxableBase8.plus(input.taxableBase10));
  put(shb047, 'DUD00010', official.tax8);
  put(shb047, 'DUD00020', official.tax10);
  put(shb047, 'DUD00030', official.outputTax);
  put(shb047, 'DUE00010', input.badDebtRecoveryTax8);
  put(shb047, 'DUE00020', input.badDebtRecoveryTax10);
  put(shb047, 'DUE00030', badDebtRecoveryTaxTotal);
  put(shb047, 'DUF00020', deemedInput8);
  put(shb047, 'DUF00030', deemedInput10);
  put(shb047, 'DUF00040', deemedInputTotal);
  put(shb047, 'DUF00100', input.badDebtTax8);
  put(shb047, 'DUF00110', input.badDebtTax10);
  put(shb047, 'DUF00120', badDebtTaxTotal);
  put(shb047, 'DUF00140', deemedInput8.plus(input.badDebtTax8));
  put(shb047, 'DUF00150', deemedInput10.plus(input.badDebtTax10));
  put(shb047, 'DUF00160', deemedInputTotal.plus(badDebtTaxTotal));

  const nationalNetRaw = official.outputTax
    .plus(badDebtRecoveryTaxTotal)
    .minus(deemedInputTotal)
    .minus(badDebtTaxTotal);
  const filing = filingBreakdown(nationalNetRaw);
  putSigned(shb047, 'DUH00000', 'DUG00000', D(filing.national));
  putSigned(shb047, 'DUI00020', 'DUI00010', D(filing.national));
  putSigned(shb047, 'DUJ00020', 'DUJ00010', D(filing.local));

  const shb067: XtxLeafValues = {};
  put(shb067, 'DVB00020', official.tax8);
  put(shb067, 'DVB00030', official.tax10);
  put(shb067, 'DVB00040', official.outputTax);
  put(shb067, 'DVB00060', input.badDebtRecoveryTax8);
  put(shb067, 'DVB00070', input.badDebtRecoveryTax10);
  put(shb067, 'DVB00080', badDebtRecoveryTaxTotal);
  put(shb067, 'DVB00140', basicBase8);
  put(shb067, 'DVB00150', basicBase10);
  put(shb067, 'DVB00160', basicBase8.plus(basicBase10));

  let shb067Raw: XtxRawValues;
  if (categorySplit) {
    // (1) 事業区分別の課税売上高（税抜き）の明細：⑥合計＋設定区分・第四種の各欄
    // （売上対価の返還等はaoikoの集計で既にネット済みのため、⑥〜⑫の金額はそのまま
    // 記載要領2⑵の「返還等の金額を控除した後の金額」に該当する）
    const totalSalesBase = input.taxableBase8.plus(input.taxableBase10);
    put(shb067, 'DVD00030', input.taxableBase8);
    put(shb067, 'DVD00040', input.taxableBase10);
    put(shb067, 'DVD00050', totalSalesBase);
    const mainSalesBase8 = input.taxableBase8.minus(markedBase8);
    const mainSalesBase10 = input.taxableBase10.minus(markedBase10);
    if (input.category === 4) {
      // 設定区分自体が第四種のときは印の付いた行分と合算した単一欄になる
      put(shb067, tagNum(CATEGORY_DVD_SALES_TAG[4] + 10), input.taxableBase8);
      put(shb067, tagNum(CATEGORY_DVD_SALES_TAG[4] + 20), input.taxableBase10);
      put(shb067, tagNum(CATEGORY_DVD_SALES_TAG[4] + 40), totalSalesBase);
      shb067[tagNum(CATEGORY_DVD_SALES_TAG[4] + 50)] = floorPercent(totalSalesBase, totalSalesBase);
    } else {
      const mainSalesTag = CATEGORY_DVD_SALES_TAG[input.category];
      const mainSalesTotal = mainSalesBase8.plus(mainSalesBase10);
      put(shb067, tagNum(mainSalesTag + 10), mainSalesBase8);
      put(shb067, tagNum(mainSalesTag + 20), mainSalesBase10);
      put(shb067, tagNum(mainSalesTag + 40), mainSalesTotal);
      shb067[tagNum(mainSalesTag + 50)] = floorPercent(mainSalesTotal, totalSalesBase);
      const cat4SalesTag = CATEGORY_DVD_SALES_TAG[4];
      const cat4SalesTotal = markedBase8.plus(markedBase10);
      put(shb067, tagNum(cat4SalesTag + 10), markedBase8);
      put(shb067, tagNum(cat4SalesTag + 20), markedBase10);
      put(shb067, tagNum(cat4SalesTag + 40), cat4SalesTotal);
      shb067[tagNum(cat4SalesTag + 50)] = floorPercent(cat4SalesTotal, totalSalesBase);
    }
    // (2) 事業区分別の課税売上高に係る消費税額の明細（貸倒回収を含まない、区分別の生の税額）
    put(shb067, 'DVD00430', mainTaxOnly8.plus(mainTaxOnly10).plus(officialMarked.outputTax));
    put(shb067, 'DVD00440', mainTaxOnly8.plus(officialMarked.tax8));
    put(shb067, 'DVD00450', mainTaxOnly10.plus(officialMarked.tax10));
    const mainTag = CATEGORY_DVD_DETAIL_TAG[input.category];
    put(shb067, tagNum(mainTag + 10), mainTaxOnly8);
    put(shb067, tagNum(mainTag + 20), mainTaxOnly10);
    put(shb067, tagNum(mainTag + 30), mainTaxOnly8.plus(mainTaxOnly10));
    const cat4Tag = CATEGORY_DVD_DETAIL_TAG[4];
    put(shb067, tagNum(cat4Tag + 10), officialMarked.tax8);
    put(shb067, tagNum(cat4Tag + 20), officialMarked.tax10);
    put(shb067, tagNum(cat4Tag + 30), officialMarked.outputTax);
    // (3) 控除対象仕入税額の計算式区分の明細：イ原則／ロ特例のうち採用した方をハへ転記
    put(shb067, 'DVE00020', categorySplit.principle8);
    put(shb067, 'DVE00030', categorySplit.principle10);
    put(shb067, 'DVE00040', categorySplit.principleTotal);
    // 二区分（合計75%）の特例は各区分が自らの率を適用する式と代数的に原則と同値になる
    // （consumption-tax.ts の computeSimplifiedCategoryDeduction 参照）ため、二区分の
    // 計算式区分（ロ(ロ)）には転記対象が無い。単一区分が75%以上（ロ(イ)）の場合のみ、
    // 該当区分を DVE00070 の kubun_CD で示す
    if (categorySplit.specialCategory !== undefined && categorySplit.specialCategory !== 'combo') {
      put(shb067, 'DVE00080', categorySplit.special8);
      put(shb067, 'DVE00090', categorySplit.special10);
      put(shb067, 'DVE00100', categorySplit.specialTotal);
      shb067Raw = { DVE00070: `<kubun_CD>${categorySplit.specialCategory}</kubun_CD>` };
    } else {
      shb067Raw = {};
    }
    put(shb067, 'DVE00730', categorySplit.deduction8);
    put(shb067, 'DVE00740', categorySplit.deduction10);
    put(shb067, 'DVE00750', categorySplit.deductionTotal);
  } else {
    put(shb067, 'DVC00020', deemedInput8);
    put(shb067, 'DVC00030', deemedInput10);
    put(shb067, 'DVC00040', deemedInputTotal);
    shb067Raw = { DVC00010: `<kubun_CD>${input.category}</kubun_CD>` };
  }

  const sha020 = buildSha020Common(
    official,
    deemedInputTotal,
    badDebtTaxTotal,
    badDebtRecoveryTaxTotal,
    input.interimPaidNational ?? D(0),
    input.interimPaidLocal ?? D(0),
  );
  const mainSalesBase = hasMarkedTransfer
    ? input.taxableBase8.plus(input.taxableBase10).minus(markedBase8).minus(markedBase10)
    : input.taxableBase8.plus(input.taxableBase10);
  if (hasMarkedTransfer && input.category !== 4) {
    put(sha020, CATEGORY_TAXABLE_SALES_TAG[input.category], mainSalesBase);
    put(sha020, CATEGORY_TAXABLE_SALES_TAG[4], markedBase8.plus(markedBase10));
  } else {
    put(
      sha020,
      CATEGORY_TAXABLE_SALES_TAG[input.category],
      input.taxableBase8.plus(input.taxableBase10),
    );
  }
  const sha020Raw: XtxRawValues = {};
  const interimPeriodRaw = buildInterimPeriodRaw(input.interimPeriod);
  if (interimPeriodRaw) {
    sha020Raw.ABH00160 = interimPeriodRaw;
  }
  // ABL00210「特例計算適用（令57(3)）」：採用額が原則計算と異なる（＝75%特例を採用した）
  // ときに kubun_CD=1 を立てる。ABY00000 の2割特例チェックと同じ「立てるのは1のみ」規約
  if (categorySplit && !categorySplit.deductionTotal.equals(categorySplit.principleTotal)) {
    sha020Raw.ABL00210 = '<kubun_CD>1</kubun_CD>';
  }

  return {
    sha020,
    sha020Raw,
    shb047,
    shb067,
    shb067Raw,
  };
}
