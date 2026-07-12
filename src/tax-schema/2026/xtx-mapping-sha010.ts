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
  reverseChargeApplies,
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
  /** 特定課税仕入れのうち個別対応方式の用途区分別内訳（常に標準税率＝7.8%分のみ） */
  reverseChargeCommonTax: Decimal;
  reverseChargeNonTaxableOnlyTax: Decimal;
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
  const salesRatio = computeTaxableSalesRatio(
    input.taxableBase10,
    input.taxableBase8,
    input.exportExemptSalesBase,
    input.nonTaxableSalesBase
  );
  // 特定課税仕入れ（リバースチャージ）は一般課税かつ課税売上割合95%未満のときのみ、
  // 売上（課税標準）と控除の双方へ対称に配線する。非適用時は全 RC 値をゼロ化し、
  // 課税標準・控除・付表いずれにも RC 系タグが立たないようにする。
  const rcApplies = reverseChargeApplies(salesRatio);
  const rcBase = rcApplies ? input.reverseChargeBase : D(0);
  const rcTax = rcApplies ? input.reverseChargeTax : D(0);
  const rcCommon = rcApplies ? input.reverseChargeCommonTax : D(0);
  const rcNonTaxableOnly = rcApplies ? input.reverseChargeNonTaxableOnlyTax : D(0);
  // 課税標準額は特定課税仕入れの対価を7.8%欄に合算してから千円未満切捨て（国税庁の手引き）。
  const official = computeOfficialOutputTax(input.taxableBase10.plus(rcBase), input.taxableBase8);
  const input10Rounded = input.input10.toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const input8Rounded = input.input8.toDecimalPlaces(0, Decimal.ROUND_DOWN);
  // 控除対象仕入税額の7.8%側には特定課税仕入れの消費税額を織り込む（付表1-3・第一表用）。
  const input10Eff = input10Rounded.plus(rcTax);
  const inputTotalEff = input10Eff.plus(input8Rounded);
  const fullDeduction = isFullDeductionEligible(salesRatio);
  const deductibleInput = fullDeduction
    ? inputTotalEff
    : computeAttributedDeduction(input, salesRatio, rcTax, rcCommon, rcNonTaxableOnly);
  const badDebtTaxTotal = input.badDebtTax10.plus(input.badDebtTax8);
  const badDebtRecoveryTaxTotal = input.badDebtRecoveryTax10.plus(input.badDebtRecoveryTax8);

  const shb017 = buildShb017(
    official,
    input10Eff,
    input8Rounded,
    deductibleInput,
    input.badDebtTax10,
    input.badDebtTax8,
    input.badDebtRecoveryTax10,
    input.badDebtRecoveryTax8,
    rcApplies,
    rcBase,
    input.taxableBase8,
    input.taxableBase10
  );
  const shb033 = buildShb033(
    input,
    official,
    input10Rounded,
    input8Rounded,
    salesRatio,
    fullDeduction,
    deductibleInput,
    rcTax,
    rcBase,
    rcCommon,
    rcNonTaxableOnly
  );
  const sha010 = buildSha010(
    official,
    deductibleInput,
    salesRatio.taxableSalesTotal,
    badDebtTaxTotal,
    badDebtRecoveryTaxTotal,
    input.interimPaidNational ?? D(0),
    input.interimPaidLocal ?? D(0),
    rcApplies,
    rcBase,
    input.taxableBase8,
    input.taxableBase10
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
  salesRatio: TaxableSalesRatio,
  rcTax: Decimal,
  rcCommon: Decimal,
  rcNonTaxableOnly: Decimal
): Decimal {
  // 特定課税仕入れの消費税額（常に7.8%）を課税仕入れ等の税額の合計へ織り込む。
  // 用途区分は共通対応分に rcCommon・非課税のみ対応分に rcNonTaxableOnly、残りは課税売上のみ対応分。
  const inputTotal = input.input10
    .plus(input.input8)
    .plus(rcTax)
    .toDecimalPlaces(0, Decimal.ROUND_DOWN);
  if (input.attributionMethod === 'proportional') {
    return inputTotal.times(salesRatio.ratio).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  }
  const common = input.inputCommon10.plus(input.inputCommon8).plus(rcCommon);
  const nonTaxableOnly = input.inputNonTaxableOnly10
    .plus(input.inputNonTaxableOnly8)
    .plus(rcNonTaxableOnly);
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
  badDebtRecoveryTax8: Decimal,
  rcApplies: boolean,
  rcBase: Decimal,
  taxableBase8: Decimal,
  taxableBase10: Decimal
): XtxLeafValues {
  const shb017: XtxLeafValues = {};
  put(shb017, 'DSB00010', official.base8);
  put(shb017, 'DSB00020', official.base10);
  put(shb017, 'DSB00030', official.taxableBase);
  // (1)の内訳：特定課税仕入れ適用時のみ、課税資産の譲渡等の対価の額（生の税抜対価）と
  // 特定課税仕入れに係る支払対価の額を分離表示する（課税標準額 DSB は合算後の千円未満切捨て）
  if (rcApplies && !rcBase.isZero()) {
    put(shb017, 'DSC00020', taxableBase8);
    put(shb017, 'DSC00030', taxableBase10);
    put(shb017, 'DSC00040', taxableBase8.plus(taxableBase10));
    put(shb017, 'DSC00060', rcBase);
    put(shb017, 'DSC00070', rcBase);
  }
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
  salesRatio: TaxableSalesRatio,
  fullDeduction: boolean,
  deductibleInput: Decimal,
  rcTax: Decimal,
  rcBase: Decimal,
  rcCommon: Decimal,
  rcNonTaxableOnly: Decimal
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

  // ⑧ 課税仕入れに係る消費税額：国内分のみ（輸入消費税は⑪、特定課税仕入れは⑩で別掲するため
  // 課税仕入れ由来の input8/input10 から輸入消費税分を控除する）
  const domestic8 = input8.minus(input.importTax8);
  const domestic10 = input10.minus(input.importTax10);
  put(shb033, 'DTE00060', domestic8);
  put(shb033, 'DTE00070', domestic10);
  put(shb033, 'DTE00080', domestic8.plus(domestic10));
  // ⑨⑩ 特定課税仕入れ（適用時のみ。非適用時は rcBase/rcTax がゼロで put がスキップ）
  put(shb033, 'DTE00100', rcBase);
  put(shb033, 'DTE00110', rcBase);
  put(shb033, 'DTE00130', rcTax);
  put(shb033, 'DTE00140', rcTax);
  // ⑪ 課税貨物に係る消費税額（輸入消費税）
  put(shb033, 'DTE00160', input.importTax8);
  put(shb033, 'DTE00170', input.importTax10);
  put(shb033, 'DTE00180', input.importTax8.plus(input.importTax10));
  // 貸倒回収に係る消費税額
  put(shb033, 'DTJ00010', input.badDebtRecoveryTax8);
  put(shb033, 'DTJ00020', input.badDebtRecoveryTax10);
  put(shb033, 'DTJ00030', input.badDebtRecoveryTax8.plus(input.badDebtRecoveryTax10));
  // ⑬ 課税仕入れ等の税額の合計額 = ⑧＋⑩＋⑪（列別。6.24%＝⑧6.24＋⑪6.24、7.8%＝⑧7.8＋⑩＋⑪7.8）
  const total8 = domestic8.plus(input.importTax8);
  const total10 = domestic10.plus(rcTax).plus(input.importTax10);
  put(shb033, 'DTE00240', total8);
  put(shb033, 'DTE00250', total10);
  put(shb033, 'DTE00260', total8.plus(total10));

  // 控除対象仕入税額の税率別内訳。特定課税仕入れ（常に7.8%）は10%側に織り込む
  const input10Eff = input10.plus(rcTax);
  if (fullDeduction) {
    put(shb033, 'DTF00010', input8);
    put(shb033, 'DTF00020', input10Eff);
    put(shb033, 'DTF00030', input8.plus(input10Eff));
  } else if (input.attributionMethod === 'proportional') {
    // 一括比例配分方式は税率別の内訳欄を持たず、合計欄のみ
    shb033.DTG00170 = toKingaku(deductibleInput);
  } else {
    const common10 = input.inputCommon10.plus(rcCommon);
    const nonTaxableOnly10 = input.inputNonTaxableOnly10.plus(rcNonTaxableOnly);
    const taxableOnly8 = input8.minus(input.inputCommon8).minus(input.inputNonTaxableOnly8);
    const taxableOnly10 = input10Eff.minus(common10).minus(nonTaxableOnly10);
    put(shb033, 'DTG00030', taxableOnly8);
    put(shb033, 'DTG00040', taxableOnly10);
    put(shb033, 'DTG00050', taxableOnly8.plus(taxableOnly10));
    put(shb033, 'DTG00070', input.inputCommon8);
    put(shb033, 'DTG00080', common10);
    put(shb033, 'DTG00090', input.inputCommon8.plus(common10));
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
  interimPaidLocal: Decimal,
  rcApplies: boolean,
  rcBase: Decimal,
  taxableBase8: Decimal,
  taxableBase10: Decimal
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
  // 特定課税仕入れ適用時のみ、課税資産の譲渡等の対価の額は生の税抜対価（RC を含めない、
  // 1円未満切捨て）を示し、特定課税仕入れは AAR に別掲する。①（AAP00000）は合算後の千円未満切捨て。
  // 非適用時は実機検証済みの現行出力（official.base8/base10/taxableBase）を変えない。
  if (rcApplies && !rcBase.isZero()) {
    put(sha010, 'AAQ00040', taxableBase8);
    put(sha010, 'AAQ00050', taxableBase10);
    put(sha010, 'AAQ00060', taxableBase8.plus(taxableBase10));
    put(sha010, 'AAR00020', rcBase);
    put(sha010, 'AAR00030', rcBase);
  } else {
    put(sha010, 'AAQ00040', official.base8);
    put(sha010, 'AAQ00050', official.base10);
    put(sha010, 'AAQ00060', official.taxableBase);
  }
  put(sha010, 'AAS00000', official.outputTax);
  put(sha010, 'AAT00040', official.tax8);
  put(sha010, 'AAT00050', official.tax10);
  put(sha010, 'AAW00010', filingNational);
  put(sha010, 'AAW00040', filingNational);
  return sha010;
}