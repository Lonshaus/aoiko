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
//  - 中間納付税額：確定申告のみ対象

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
import type { XtxLeafValues } from './xtx-document';

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
}

export interface GeneralMapping {
  /** SHA010（申告書）第一表・第二表の直接値 leaf */
  sha010: XtxLeafValues;
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
    badDebtRecoveryTaxTotal
  );

  return { sha010, shb017, shb033 };
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
  put(shb017, 'DSH00000', D(filing.national));
  put(shb017, 'DSI00020', D(filing.national));
  put(shb017, 'DSJ00020', D(filing.local));
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

function buildSha010(
  official: OfficialOutputTax,
  deductibleInput: Decimal,
  taxableSalesTotal: Decimal,
  badDebtTaxTotal: Decimal,
  badDebtRecoveryTaxTotal: Decimal
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
  const filingTotal = D(filing.total);
  put(sha010, 'AAJ00100', filingNational);
  put(sha010, 'AAJ00120', filingNational);
  put(sha010, 'AAK00030', filingNational);
  put(sha010, 'AAK00060', filingLocal);
  put(sha010, 'AAK00080', filingLocal);
  put(sha010, 'AAK00130', filingTotal);
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