// aoiko 業務データ（消費税集計）→ SHA010（消費税及び地方消費税の申告書・一般用）
// + SHB017（付表1-3）+ SHB033（付表2-3）の値マップ（本則課税）。
//
// 対応していない項目（簡略化・既知の限界）：
//  - 免税売上・非課税売上：aoiko は全売上が課税資産の譲渡等であることを前提とする
//    （課税売上割合は常に100%として扱う＝付表2-3 の「課税売上高が５億円以下、かつ、
//    課税売上割合が95％以上の場合」区分のみ対応。個別対応方式・一括比例配分方式
//    （5億円超・95%未満）は未対応）
//  - 特定課税仕入れ・課税貨物に係る消費税額（リバースチャージ・輸入消費税）：未対応
//  - 納税義務の免除を受けない（受ける）こととなった場合の調整額：未対応
//  - 課税仕入れに係る支払対価の額（税込み）：aoiko の集計は税額のみを保持し
//    税込支払対価の額を別途保持していないため、参考記載欄は出力しない
//    （申告の税額計算自体には影響しない）
//  - 売上対価の返還等に係る税額：aoiko の集計は返品・値引を課税標準額へネットで
//    反映済みのため、内訳を分離して転記しない（最終税額は正しいが内訳表示にはならない）
//  - 中間納付税額：確定申告のみ対象

import { D, Decimal } from '../../lib/decimal';
import {
  computeOfficialOutputTax,
  filingBreakdown,
  type OfficialOutputTax,
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
// aoiko は課税売上割合100%（全売上が課税資産の譲渡等）を前提とするため、
// 付表2-3 は「課税売上高5億円以下・課税売上割合95%以上」の全額控除区分のみ使う。
export function mapGeneral(input: GeneralMappingInput): GeneralMapping {
  const official = computeOfficialOutputTax(input.taxableBase10, input.taxableBase8);
  const input10Rounded = input.input10.toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const input8Rounded = input.input8.toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const inputTotal = input10Rounded.plus(input8Rounded);
  const taxableSalesTotal = input.taxableBase10.plus(input.taxableBase8);

  const shb017 = buildShb017(official, input10Rounded, input8Rounded, inputTotal);
  const shb033 = buildShb033(official, input10Rounded, input8Rounded, inputTotal, taxableSalesTotal);
  const sha010 = buildSha010(official, inputTotal, taxableSalesTotal);

  return { sha010, shb017, shb033 };
}

function buildShb017(
  official: OfficialOutputTax,
  input10: Decimal,
  input8: Decimal,
  inputTotal: Decimal
): XtxLeafValues {
  const shb017: XtxLeafValues = {};
  put(shb017, 'DSB00010', official.base8);
  put(shb017, 'DSB00020', official.base10);
  put(shb017, 'DSB00030', official.taxableBase);
  put(shb017, 'DSD00010', official.tax8);
  put(shb017, 'DSD00020', official.tax10);
  put(shb017, 'DSD00030', official.outputTax);
  put(shb017, 'DSF00020', input8);
  put(shb017, 'DSF00030', input10);
  put(shb017, 'DSF00040', inputTotal);
  put(shb017, 'DSF00220', input8);
  put(shb017, 'DSF00230', input10);
  put(shb017, 'DSF00240', inputTotal);

  const nationalNetRaw = official.outputTax.minus(inputTotal);
  const filing = filingBreakdown(nationalNetRaw);
  put(shb017, 'DSH00000', D(filing.national));
  put(shb017, 'DSI00020', D(filing.national));
  put(shb017, 'DSJ00020', D(filing.local));
  return shb017;
}

function buildShb033(
  official: OfficialOutputTax,
  input10: Decimal,
  input8: Decimal,
  inputTotal: Decimal,
  taxableSalesTotal: Decimal
): XtxLeafValues {
  const shb033: XtxLeafValues = {};
  put(shb033, 'DTB00020', official.base8);
  put(shb033, 'DTB00030', official.base10);
  put(shb033, 'DTB00040', official.taxableBase);
  put(shb033, 'DTB00070', taxableSalesTotal);
  put(shb033, 'DTC00010', taxableSalesTotal);
  put(shb033, 'DTC00030', taxableSalesTotal);
  shb033.DTD00000 = '100.00';
  put(shb033, 'DTE00060', input8);
  put(shb033, 'DTE00070', input10);
  put(shb033, 'DTE00080', inputTotal);
  put(shb033, 'DTE00240', input8);
  put(shb033, 'DTE00250', input10);
  put(shb033, 'DTE00260', inputTotal);
  put(shb033, 'DTF00010', input8);
  put(shb033, 'DTF00020', input10);
  put(shb033, 'DTF00030', inputTotal);
  return shb033;
}

function buildSha010(
  official: OfficialOutputTax,
  inputTotal: Decimal,
  taxableSalesTotal: Decimal
): XtxLeafValues {
  const sha010: XtxLeafValues = {};
  put(sha010, 'AAJ00010', official.taxableBase);
  put(sha010, 'AAJ00020', official.outputTax);
  put(sha010, 'AAJ00050', inputTotal);
  put(sha010, 'AAJ00080', inputTotal);
  put(sha010, 'AAJ00180', taxableSalesTotal);
  put(sha010, 'AAJ00190', taxableSalesTotal);

  const nationalNetRaw = official.outputTax.minus(inputTotal);
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