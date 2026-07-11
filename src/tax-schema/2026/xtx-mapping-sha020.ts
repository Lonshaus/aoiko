// aoiko 業務データ（消費税集計）→ SHA020（消費税及び地方消費税の申告書・簡易課税用）
// の値マップ。2 つの申告方式を扱う：
//  - mapTwoWari()：2割特例（+ SHB070 付表6）
//  - mapSimplified()：簡易課税（単一事業区分のみ、+ SHB047 付表4-3、SHB067 付表5-3）
//
// 2割特例は「簡易課税を正式に選択していない事業者も SHA020 の様式構造を使う」運用
// （国税庁「２割特例用 消費税及び地方消費税の確定申告の手引き」の設例で確認済み）。
// ABY00000「税額控除に係る経過措置の適用（２割特例）」を raw（kubun_CD=1）で立てる。
//
// 対応していない項目（簡略化・既知の限界）：
//  - 売上対価の返還等に係る税額（付表6 AYB00180、付表4-3 DUF00060等）：aoiko の集計は
//    返品・値引を課税標準額へネットで反映済みのため、内訳を分離して転記しない
//    （最終税額は正しいが、明細としての内訳表示にはならない）
//  - 基準期間の課税売上高等、2割特例では「記載不要」とされる事業区分欄は出力しない
//  - 簡易課税で複数事業区分を営む場合の按分計算（75%ルール等、付表5-3 二面）は未対応。
//    aoiko の設定は単一の事業区分のみを持つ前提（[07. 消費税] マニュアル参照）
//  - 中間納付税額の確定申告への充当（ABI00110-130・ABJ00070-090）：本年中の中間納付額が
//    当年の差引税額を超えて還付になるケース（ABJ00130 合計が負値）は未検証

import { D, Decimal } from '../../lib/decimal';
import {
  computeOfficialOutputTax,
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
  interimPaidLocal: Decimal
): XtxLeafValues {
  const creditSubtotal = creditTotal.plus(badDebtTax);
  const nationalNetRaw = official.outputTax.plus(badDebtRecoveryTax).minus(creditSubtotal);
  const filing = filingBreakdown(nationalNetRaw);
  const filingNational = D(filing.national);
  const filingLocal = D(filing.local);

  const sha020: XtxLeafValues = {};
  put(sha020, 'ABI00010', official.taxableBase);
  put(sha020, 'ABI00020', official.outputTax);
  put(sha020, 'ABI00030', badDebtRecoveryTax);
  put(sha020, 'ABI00050', creditTotal);
  put(sha020, 'ABI00070', badDebtTax);
  put(sha020, 'ABI00080', creditSubtotal);
  put(sha020, 'ABI00100', filingNational);
  put(sha020, 'ABJ00030', filingNational);
  put(sha020, 'ABJ00060', filingLocal);

  const national = applyInterimCredit(filingNational, interimPaidNational);
  const local = applyInterimCredit(filingLocal, interimPaidLocal);
  if (interimPaidNational.greaterThan(0)) {
    put(sha020, 'ABI00110', interimPaidNational);
    if (national.refund.greaterThan(0)) {
      put(sha020, 'ABI00130', national.refund);
    } else {
      put(sha020, 'ABI00120', national.due);
    }
  } else {
    put(sha020, 'ABI00120', filingNational);
  }
  if (interimPaidLocal.greaterThan(0)) {
    put(sha020, 'ABJ00070', interimPaidLocal);
    if (local.refund.greaterThan(0)) {
      put(sha020, 'ABJ00090', local.refund);
    } else {
      put(sha020, 'ABJ00080', local.due);
    }
  } else {
    put(sha020, 'ABJ00080', filingLocal);
  }
  put(
    sha020,
    'ABJ00130',
    national.due.minus(national.refund).plus(local.due).minus(local.refund)
  );
  // 第二表（内訳）：軽減税率のみの利用者が多い想定だが、両税率とも同じ値を転記
  put(sha020, 'ABO00000', official.taxableBase);
  put(sha020, 'ABP00040', official.base8);
  put(sha020, 'ABP00050', official.base10);
  put(sha020, 'ABP00060', official.taxableBase);
  put(sha020, 'ABR00000', official.outputTax);
  put(sha020, 'ABS00040', official.tax8);
  put(sha020, 'ABS00050', official.tax10);
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

export interface TwoWariMappingInput {
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
  /** 本年中に中間納付した消費税額（国税分）。確定申告の差引税額から充当する */
  interimPaidNational?: Decimal;
  /** 本年中に中間納付した地方消費税額（譲渡割額）。確定申告の差引税額から充当する */
  interimPaidLocal?: Decimal;
}

export interface TwoWariMapping {
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
//  Step4 返還等対価に係る税額（本対応では 0 固定。上記コメント参照）
//  Step4.5 貸倒回収に係る消費税額を加算（消費税法39条は2割特例にも適用）
//  Step5 控除対象仕入税額の計算の基礎となる消費税額 = Step3 − Step4 ＋ 貸倒回収
//  Step6 特別控除税額 = Step5 × 80%（1円未満切り捨て）
//  貸倒れに係る税額は特別控除税額とは別枠で、最終税額の計算時に減算する（AYD）
export function mapTwoWari(input: TwoWariMappingInput): TwoWariMapping {
  const official = computeOfficialOutputTax(input.taxableBase10, input.taxableBase8);
  const basicBase8 = official.tax8.plus(input.badDebtRecoveryTax8);
  const basicBase10 = official.tax10.plus(input.badDebtRecoveryTax10);
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
    input.interimPaidLocal ?? D(0)
  );
  const sha020Raw: XtxRawValues = { ABY00000: '<kubun_CD>1</kubun_CD>' };

  return {
    sha020,
    sha020Raw,
    shb070,
  };
}

export interface SimplifiedMappingInput {
  /** 課税資産の譲渡等の対価の額（税抜、標準税率10%＝国税7.8%分）。返品・値引ネット後 */
  taxableBase10: Decimal;
  /** 課税資産の譲渡等の対価の額（税抜、軽減税率8%＝国税6.24%分）。返品・値引ネット後 */
  taxableBase8: Decimal;
  /** 事業区分（第1種〜第6種）。aoiko は単一事業区分のみ対応（複数区分の按分は未対応） */
  category: SimplifiedTaxCategory;
  /** みなし仕入率（第1種90%〜第6種40%）。simplified-tax.ts の deemedInputRate() の結果を渡す */
  deemedInputRate: number;
  /** 貸倒れに係る税額（税率別） */
  badDebtTax10: Decimal;
  badDebtTax8: Decimal;
  /** 貸倒回収に係る消費税額（税率別） */
  badDebtRecoveryTax10: Decimal;
  badDebtRecoveryTax8: Decimal;
  /** 中間申告（仮決算方式）の対象期間。指定時は ABH00160 に転記する */
  interimPeriod?: { start: string; end: string };
  /** 本年中に中間納付した消費税額（国税分）。確定申告の差引税額から充当する */
  interimPaidNational?: Decimal;
  /** 本年中に中間納付した地方消費税額（譲渡割額）。確定申告の差引税額から充当する */
  interimPaidLocal?: Decimal;
}

export interface SimplifiedMapping {
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
// 簡易課税（単一事業区分）：控除対象仕入税額 = (課税標準額に対する消費税額＋貸倒回収) ×
// みなし仕入率（基準消費税額に貸倒回収を算入するのは国税庁「簡易課税用申告の手引き」どおり）。
// 貸倒れに係る税額はみなし仕入率の計算とは別枠で、最終税額の計算時に減算する。
// aoiko は複数事業区分の按分計算（75%ルール等）には対応しない
// （既存の [07. 消費税] マニュアルの注意点どおり、混合事業のケースは対象外）。
export function mapSimplified(input: SimplifiedMappingInput): SimplifiedMapping {
  const official = computeOfficialOutputTax(input.taxableBase10, input.taxableBase8);
  const basicBase8 = official.tax8.plus(input.badDebtRecoveryTax8);
  const basicBase10 = official.tax10.plus(input.badDebtRecoveryTax10);
  const deemedInput8 = basicBase8
    .times(input.deemedInputRate)
    .toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const deemedInput10 = basicBase10
    .times(input.deemedInputRate)
    .toDecimalPlaces(0, Decimal.ROUND_DOWN);
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
  put(shb047, 'DUH00000', D(filing.national));
  put(shb047, 'DUI00020', D(filing.national));
  put(shb047, 'DUJ00020', D(filing.local));

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
  put(shb067, 'DVC00020', deemedInput8);
  put(shb067, 'DVC00030', deemedInput10);
  put(shb067, 'DVC00040', deemedInputTotal);

  const sha020 = buildSha020Common(
    official,
    deemedInputTotal,
    badDebtTaxTotal,
    badDebtRecoveryTaxTotal,
    input.interimPaidNational ?? D(0),
    input.interimPaidLocal ?? D(0)
  );
  put(
    sha020,
    CATEGORY_TAXABLE_SALES_TAG[input.category],
    input.taxableBase8.plus(input.taxableBase10)
  );
  const sha020Raw: XtxRawValues = {};
  const interimPeriodRaw = buildInterimPeriodRaw(input.interimPeriod);
  if (interimPeriodRaw) {
    sha020Raw.ABH00160 = interimPeriodRaw;
  }

  return {
    sha020,
    sha020Raw,
    shb047,
    shb067,
    shb067Raw: { DVC00010: `<kubun_CD>${input.category}</kubun_CD>` },
  };
}