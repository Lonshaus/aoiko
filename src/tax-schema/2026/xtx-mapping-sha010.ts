// aoiko 業務データ（消費税集計）→ SHA010（消費税及び地方消費税の申告書・一般用）
// + SHB017（付表1-3）+ SHB033（付表2-3）の値マップ（本則課税）。
//
// 対応していない項目（簡略化・既知の限界）：
//  - 納税義務の免除を受けない（受ける）こととなった場合の調整額：未対応
//  - 課税仕入れに係る支払対価の額（税込み）：aoiko の集計は税額のみを保持し
//    税込支払対価の額を別途保持していないため、参考記載欄は出力しない
//    （申告の税額計算自体には影響しない）
//  - 適格請求書発行事業者以外からの課税仕入れに係る経過措置（DTE00270-340）：内訳欄は出力しない
//    （控除額自体は経過措置適用後の input10/input8 に反映済みのため税額計算には影響しない）
//  - 売上対価の返還等に係る税額：aoiko の集計は返品・値引を課税標準額へネットで
//    反映済みのため、内訳を分離して転記しない（最終税額は正しいが内訳表示にはならない）
//  - 控除不足還付（仕入税額控除が売上税額を上回る本体還付）は差引税額（AAJ00100）へ負値を
//    書かず、控除不足還付税額欄（国税 AAJ00090・地方 AAK00020/AAK00050）へ正値で出力する。
//    中間納付の充当は差引税額（納付側）に対してのみ行い、還付時は中間納付額の全額が
//    中間納付還付税額（AAJ00130/AAK00090）となる。AAK00130 は符号付き純額（負＝還付）

import { D, Decimal } from '../../lib/decimal';
import {
  computeOfficialOutputTax,
  computeTaxableSalesRatio,
  filingBreakdown,
  isFullDeductionEligible,
  type ConsumptionTaxAttributionMethod,
  type OfficialOutputTax,
  type TaxableSalesRatio,
} from '../../domain/consumption-tax';
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
// 正値で記載する（⑧控除不足還付税額・地方の控除不足還付・還付額など）。
function putSigned(out: XtxLeafValues, dueTag: string, refundTag: string, value: Decimal): void {
  if (value.isNegative()) {
    put(out, refundTag, value.negated());
  } else {
    put(out, dueTag, value);
  }
}

export interface GeneralMappingInput {
  /** 課税資産の譲渡等の対価の額（税抜、標準税率10%＝国税7.8%分）。返品・値引ネット後 */
  taxableBase10: Decimal;
  /** 課税資産の譲渡等の対価の額（税抜、軽減税率8%＝国税6.24%分）。返品・値引ネット後 */
  taxableBase8: Decimal;
  /** 控除対象仕入税額（国税分、標準税率10%＝7.8%分、経過措置適用後） */
  input10: Decimal;
  /** 控除対象仕入税額（国税分、軽減税率8%＝6.24%分、経過措置適用後） */
  input8: Decimal;
  /** 免税売上高（輸出等） */
  exportExemptSalesBase: Decimal;
  /** 非課税売上高 */
  nonTaxableSalesBase: Decimal;
  /** 個別対応方式：課税売上げと非課税売上げに共通して要する仕入税額（税率別） */
  inputCommon10: Decimal;
  inputCommon8: Decimal;
  /** 個別対応方式：非課税売上げにのみ要する仕入税額（税率別） */
  inputNonTaxableOnly10: Decimal;
  inputNonTaxableOnly8: Decimal;
  /** 課税貨物に係る消費税額（輸入消費税、税率別） */
  importTax10: Decimal;
  importTax8: Decimal;
  /** 特定課税仕入れ（リバースチャージ）に係る支払対価の額・消費税額 */
  reverseChargeBase: Decimal;
  reverseChargeTax: Decimal;
  /** 課税売上高5億円超または課税売上割合95%未満のときの控除計算方式 */
  attributionMethod: ConsumptionTaxAttributionMethod;
  /** 貸倒れに係る税額（税率別） */
  badDebtTax10: Decimal;
  badDebtTax8: Decimal;
  /** 貸倒回収に係る消費税額（税率別） */
  badDebtRecoveryTax10: Decimal;
  badDebtRecoveryTax8: Decimal;
  /** 中間申告（仮決算方式）の対象期間。指定時は AAI00160 に転記し、
   * SHINKOKU_KBN=2（中間）と組み合わせて中間申告用の .xtx を生成する */
  interimPeriod?: { start: string; end: string };
  /** 本年中に中間納付した消費税額（国税分）。確定申告の差引税額から充当する */
  interimPaidNational?: Decimal;
  /** 本年中に中間納付した地方消費税額（譲渡割額）。確定申告の差引税額から充当する */
  interimPaidLocal?: Decimal;
}

export interface GeneralMapping {
  /** SHA010（申告書）第一表・第二表の直接値 leaf */
  sha010: XtxLeafValues;
  /** SHA010 の区分（kubun）ブランチ上書き：中間申告の対象期間 */
  sha010Raw: XtxRawValues;
  /** SHB017（付表1-3） */
  shb017: XtxLeafValues;
  /** SHB033（付表2-3） */
  shb033: XtxLeafValues;
}
// 本則課税：控除対象仕入税額 = 実際の課税仕入に係る消費税額（経過措置適用後）。
// 課税売上高5億円以下・課税売上割合95%以上なら付表2-3 の全額控除区分（DTF）、
// それ以外は attributionMethod に応じて個別対応方式（DTG00010系）または
// 一括比例配分方式（DTG00140）を使う。
export function mapGeneral(input: GeneralMappingInput): GeneralMapping {
  const official = computeOfficialOutputTax(input.taxableBase10, input.taxableBase8);
  const input10Rounded = input.input10.toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const input8Rounded = input.input8.toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const inputTotal = input10Rounded.plus(input8Rounded);
  const salesRatio = computeTaxableSalesRatio(
    input.taxableBase10,
    input.taxableBase8,
    input.exportExemptSalesBase,
    input.nonTaxableSalesBase
  );
  const fullDeduction = isFullDeductionEligible(salesRatio);
  const deductibleInput = fullDeduction
    ? inputTotal
    : computeAttributedDeduction(input, salesRatio);
  const badDebtTaxTotal = input.badDebtTax10.plus(input.badDebtTax8);
  const badDebtRecoveryTaxTotal = input.badDebtRecoveryTax10.plus(input.badDebtRecoveryTax8);

  const shb017 = buildShb017(
    official,
    input10Rounded,
    input8Rounded,
    deductibleInput,
    input.badDebtTax10,
    input.badDebtTax8,
    input.badDebtRecoveryTax10,
    input.badDebtRecoveryTax8
  );
  const shb033 = buildShb033(input, official, input10Rounded, input8Rounded, inputTotal, salesRatio, fullDeduction, deductibleInput);
  const sha010 = buildSha010(
    official,
    deductibleInput,
    salesRatio.taxableSalesTotal,
    badDebtTaxTotal,
    badDebtRecoveryTaxTotal,
    input.interimPaidNational ?? D(0),
    input.interimPaidLocal ?? D(0)
  );
  const sha010Raw: XtxRawValues = {};
  if (input.interimPeriod) {
    sha010Raw.AAI00160 =
      `<AAI00170>${toYymmdd(input.interimPeriod.start)}</AAI00170>` +
      `<AAI00180>${toYymmdd(input.interimPeriod.end)}</AAI00180>`;
  }

  return { sha010, sha010Raw, shb017, shb033 };
}

function computeAttributedDeduction(
  input: GeneralMappingInput,
  salesRatio: TaxableSalesRatio
): Decimal {
  const inputTotal = input.input10.plus(input.input8).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  if (input.attributionMethod === 'proportional') {
    return inputTotal.times(salesRatio.ratio).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  }
  const common = input.inputCommon10.plus(input.inputCommon8);
  const nonTaxableOnly = input.inputNonTaxableOnly10.plus(input.inputNonTaxableOnly8);
  const taxableOnly = inputTotal.minus(common).minus(nonTaxableOnly);
  return taxableOnly
    .plus(common.times(salesRatio.ratio))
    .toDecimalPlaces(0, Decimal.ROUND_DOWN);
}

function buildShb017(
  official: OfficialOutputTax,
  input10: Decimal,
  input8: Decimal,
  deductibleInput: Decimal,
  badDebtTax10: Decimal,
  badDebtTax8: Decimal,
  badDebtRecoveryTax10: Decimal,
  badDebtRecoveryTax8: Decimal
): XtxLeafValues {
  const shb017: XtxLeafValues = {};
  put(shb017, 'DSB00010', official.base8);
  put(shb017, 'DSB00020', official.base10);
  put(shb017, 'DSB00030', official.taxableBase);
  put(shb017, 'DSD00010', official.tax8);
  put(shb017, 'DSD00020', official.tax10);
  put(shb017, 'DSD00030', official.outputTax);
  // 控除過大調整税額（貸倒回収に係る消費税額）
  put(shb017, 'DSE00010', badDebtRecoveryTax8);
  put(shb017, 'DSE00020', badDebtRecoveryTax10);
  put(shb017, 'DSE00030', badDebtRecoveryTax8.plus(badDebtRecoveryTax10));
  put(shb017, 'DSF00020', input8);
  put(shb017, 'DSF00030', input10);
  put(shb017, 'DSF00040', input8.plus(input10));
  // 貸倒れに係る税額
  put(shb017, 'DSF00180', badDebtTax8);
  put(shb017, 'DSF00190', badDebtTax10);
  put(shb017, 'DSF00200', badDebtTax8.plus(badDebtTax10));
  put(shb017, 'DSF00220', input8.plus(badDebtTax8));
  put(shb017, 'DSF00230', input10.plus(badDebtTax10));
  put(shb017, 'DSF00240', deductibleInput.plus(badDebtTax8).plus(badDebtTax10));

  const badDebtRecoveryTotal = badDebtRecoveryTax8.plus(badDebtRecoveryTax10);
  const badDebtTaxTotal = badDebtTax8.plus(badDebtTax10);
  const nationalNetRaw = official.outputTax
    .plus(badDebtRecoveryTotal)
    .minus(deductibleInput)
    .minus(badDebtTaxTotal);
  const filing = filingBreakdown(nationalNetRaw);
  putSigned(shb017, 'DSH00000', 'DSG00000', D(filing.national));
  putSigned(shb017, 'DSI00020', 'DSI00010', D(filing.national));
  putSigned(shb017, 'DSJ00020', 'DSJ00010', D(filing.local));
  return shb017;
}

function buildShb033(
  input: GeneralMappingInput,
  official: OfficialOutputTax,
  input10: Decimal,
  input8: Decimal,
  inputTotal: Decimal,
  salesRatio: TaxableSalesRatio,
  fullDeduction: boolean,
  deductibleInput: Decimal
): XtxLeafValues {
  const shb033: XtxLeafValues = {};
  put(shb033, 'DTB00020', official.base8);
  put(shb033, 'DTB00030', official.base10);
  put(shb033, 'DTB00040', official.taxableBase);
  put(shb033, 'DTB00050', input.exportExemptSalesBase);
  put(shb033, 'DTB00070', salesRatio.taxableSalesTotal);
  put(shb033, 'DTC00010', salesRatio.taxableSalesTotal);
  put(shb033, 'DTC00020', input.nonTaxableSalesBase);
  put(shb033, 'DTC00030', salesRatio.totalSalesForRatio);
  shb033.DTD00000 = salesRatio.ratioPercent;

  // 特定課税仕入れ（リバースチャージ）
  put(shb033, 'DTE00100', input.reverseChargeBase);
  put(shb033, 'DTE00110', input.reverseChargeBase);
  put(shb033, 'DTE00130', input.reverseChargeTax);
  put(shb033, 'DTE00140', input.reverseChargeTax);
  // 課税貨物に係る消費税額（輸入消費税）
  put(shb033, 'DTE00160', input.importTax8);
  put(shb033, 'DTE00170', input.importTax10);
  put(shb033, 'DTE00180', input.importTax8.plus(input.importTax10));
  // 貸倒回収に係る消費税額
  put(shb033, 'DTJ00010', input.badDebtRecoveryTax8);
  put(shb033, 'DTJ00020', input.badDebtRecoveryTax10);
  put(shb033, 'DTJ00030', input.badDebtRecoveryTax8.plus(input.badDebtRecoveryTax10));

  put(shb033, 'DTE00060', input8);
  put(shb033, 'DTE00070', input10);
  put(shb033, 'DTE00080', inputTotal);
  put(shb033, 'DTE00240', input8);
  put(shb033, 'DTE00250', input10);
  put(shb033, 'DTE00260', inputTotal);

  if (fullDeduction) {
    put(shb033, 'DTF00010', input8);
    put(shb033, 'DTF00020', input10);
    put(shb033, 'DTF00030', inputTotal);
  } else if (input.attributionMethod === 'proportional') {
    // 一括比例配分方式は税率別の内訳欄を持たず、合計欄のみ
    shb033.DTG00170 = toKingaku(deductibleInput);
  } else {
    const common = input.inputCommon10.plus(input.inputCommon8);
    const taxableOnly8 = input8.minus(input.inputCommon8).minus(input.inputNonTaxableOnly8);
    const taxableOnly10 = input10.minus(input.inputCommon10).minus(input.inputNonTaxableOnly10);
    put(shb033, 'DTG00030', taxableOnly8);
    put(shb033, 'DTG00040', taxableOnly10);
    put(shb033, 'DTG00050', taxableOnly8.plus(taxableOnly10));
    put(shb033, 'DTG00070', input.inputCommon8);
    put(shb033, 'DTG00080', input.inputCommon10);
    put(shb033, 'DTG00090', common);
    shb033.DTG00130 = toKingaku(deductibleInput);
  }
  return shb033;
}

// 差引税額（base）から本年中の中間納付額（paid）を充当した結果を返す。
// paid が base を超える場合は還付（AAJ00130/AAK00090 系）扱いとする。
function applyInterimCredit(base: Decimal, paid: Decimal): { due: Decimal; refund: Decimal } {
  const diff = base.minus(paid);
  return diff.isNegative() ? { due: D(0), refund: diff.negated() } : { due: diff, refund: D(0) };
}

function buildSha010(
  official: OfficialOutputTax,
  deductibleInput: Decimal,
  taxableSalesTotal: Decimal,
  badDebtTaxTotal: Decimal,
  badDebtRecoveryTaxTotal: Decimal,
  interimPaidNational: Decimal,
  interimPaidLocal: Decimal
): XtxLeafValues {
  const sha010: XtxLeafValues = {};
  put(sha010, 'AAJ00010', official.taxableBase);
  put(sha010, 'AAJ00020', official.outputTax);
  put(sha010, 'AAJ00030', badDebtRecoveryTaxTotal);
  put(sha010, 'AAJ00050', deductibleInput);
  put(sha010, 'AAJ00070', badDebtTaxTotal);
  const creditTotal = deductibleInput.plus(badDebtTaxTotal);
  put(sha010, 'AAJ00080', creditTotal);
  put(sha010, 'AAJ00180', taxableSalesTotal);
  put(sha010, 'AAJ00190', taxableSalesTotal);

  const nationalNetRaw = official.outputTax.plus(badDebtRecoveryTaxTotal).minus(creditTotal);
  const filing = filingBreakdown(nationalNetRaw);
  const filingNational = D(filing.national);
  const filingLocal = D(filing.local);
  putSigned(sha010, 'AAJ00100', 'AAJ00090', filingNational);
  putSigned(sha010, 'AAK00030', 'AAK00020', filingNational);
  putSigned(sha010, 'AAK00060', 'AAK00050', filingLocal);

  // 中間納付の充当は差引税額（納付側）に対してのみ行う。控除不足還付（差引が負）の
  // 場合は差引税額が無く、中間納付額はその全額が中間納付還付税額となる。
  const nationalDue = filingNational.isNegative() ? D(0) : filingNational;
  const localDue = filingLocal.isNegative() ? D(0) : filingLocal;
  const national = applyInterimCredit(nationalDue, interimPaidNational);
  const local = applyInterimCredit(localDue, interimPaidLocal);
  if (interimPaidNational.greaterThan(0)) {
    put(sha010, 'AAJ00110', interimPaidNational);
    if (national.refund.greaterThan(0)) {
      put(sha010, 'AAJ00130', national.refund);
    } else {
      put(sha010, 'AAJ00120', national.due);
    }
  } else {
    put(sha010, 'AAJ00120', nationalDue);
  }
  if (interimPaidLocal.greaterThan(0)) {
    put(sha010, 'AAK00070', interimPaidLocal);
    if (local.refund.greaterThan(0)) {
      put(sha010, 'AAK00090', local.refund);
    } else {
      put(sha010, 'AAK00080', local.due);
    }
  } else {
    put(sha010, 'AAK00080', localDue);
  }
  // 合計（納付又は還付）税額：控除不足還付・中間納付還付を含む符号付き純額
  // （正＝納付、負＝還付）。控除不足還付分は差引税額(filing)の負値に含まれる。
  const combinedTotal = filingNational
    .minus(interimPaidNational)
    .plus(filingLocal)
    .minus(interimPaidLocal);
  put(sha010, 'AAK00130', combinedTotal);
  // 第二表（内訳）
  put(sha010, 'AAP00000', official.taxableBase);
  put(sha010, 'AAQ00040', official.base8);
  put(sha010, 'AAQ00050', official.base10);
  put(sha010, 'AAQ00060', official.taxableBase);
  put(sha010, 'AAS00000', official.outputTax);
  put(sha010, 'AAT00040', official.tax8);
  put(sha010, 'AAT00050', official.tax10);
  put(sha010, 'AAW00010', filingNational);
  put(sha010, 'AAW00040', filingNational);
  return sha010;
}