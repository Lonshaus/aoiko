// 消費税及び地方消費税の確定申告 .xtx 出力。
//
// 国税庁公式 W3C XSD（e-tax19）由来の schema を、所得税と同じ 2 段式 ID/IDREF
// 文書モデルで駆動する。所得税（RKO0010・KOA020等）とは別の送信データとして
// 生成する（同一の CONTENTS には併載しない。手続そのものが異なるため）。
//
// ⚠ 手続コードは様式によって異なる（RSH0010-232.xsd の CONTENTS 定義を実際に
// 読んで確認済み。2026-07-05、実機組み込みで「不明な要素 'SHA020'」エラーが出て
// 発覚——手続の CONTENTS 型が xsd:group ref で許可する様式を限定しており、
// RSH0010 は SHA010（一般用）系統のみ許可、SHA020（簡易課税用）系統は許可しない）：
//   - 一般課税（SHA010＋付表1-3＋付表2-3）　　　　　　→ 手続 RSH0010（一般・個人）
//   - 2割特例／簡易課税（SHA020＋付表6／付表4-3＋付表5-3）→ 手続 RSH0030（簡易課税・個人）
// 対応済み：2割特例（措法57の2）／簡易課税（単一事業区分のみ）／一般課税（本則）。
// 複数事業区分の簡易課税・3割特例は未対応（詳細は
// src/tax-schema/2026/xtx-mapping-sha020.ts・xtx-mapping-sha010.ts 冒頭コメント・
// docs/xtx-spec/README.md 参照）。

import sha020 from './xtx-schema-sha020.generated.json';
import shb070 from './xtx-schema-shb070.generated.json';
import shb047 from './xtx-schema-shb047.generated.json';
import shb067 from './xtx-schema-shb067.generated.json';
import sha010 from './xtx-schema-sha010.generated.json';
import shb017 from './xtx-schema-shb017.generated.json';
import shb033 from './xtx-schema-shb033.generated.json';
import type { XtxSchema } from './xtx-schema';
import { buildXtxBundle, type XtxFormInput } from './xtx-document';
import { todayISO } from '../../lib/date';
import { mapSimplified, mapTwoWari } from './xtx-mapping-sha020';
import { mapGeneral } from './xtx-mapping-sha010';
import type { SimplifiedTaxCategory } from './simplified-tax';
import type { ConsumptionTaxAttributionMethod } from '../../domain/consumption-tax';
import { toFilerInfo, type XtxFiler } from './xtx';
import type { Decimal } from '../../lib/decimal';

const SHA020_SCHEMA = sha020 as XtxSchema;
const SHB070_SCHEMA = shb070 as XtxSchema;
const SHB047_SCHEMA = shb047 as XtxSchema;
const SHB067_SCHEMA = shb067 as XtxSchema;
const SHA010_SCHEMA = sha010 as XtxSchema;
const SHB017_SCHEMA = shb017 as XtxSchema;
const SHB033_SCHEMA = shb033 as XtxSchema;
// e-tax19 shohi/RSH0010-232.xsd・RSH0030-232.xsd の documentation より。
const PROCEDURE_VERSION = '23.2.0';
// 消費税及び地方消費税申告(一般・個人)。CONTENTS が SHA010 系統のみ許可。
const PROCEDURE_TAG_GENERAL = 'RSH0010';
const PROCEDURE_NAME_GENERAL = '消費税及び地方消費税申告';
// 消費税及び地方消費税申告(簡易課税・個人)。CONTENTS が SHA020 系統のみ許可。
const PROCEDURE_TAG_SIMPLIFIED = 'RSH0030';
const PROCEDURE_NAME_SIMPLIFIED = '消費税及び地方消費税申告';

function buildBundle(
  forms: XtxFormInput[],
  businessName: string,
  filer: XtxFiler,
  procedureTag: string,
  procedureName: string,
  shinkokuKbn: string
): string {
  const creatorName = businessName.replace(/[\n\r\t]+/g, ' ').trim() || 'aoiko';
  return buildXtxBundle(forms, {
    procedureTag,
    procedureVersion: PROCEDURE_VERSION,
    procedureName,
    creatorName,
    creationDate: todayISO(),
    filer: toFilerInfo(filer),
    // RSH0010/RSH0030 の CONTENTS 型は SOFUSHO を許可しない（xtx-document.ts の
    // XtxDocumentOptions.includeSofusho コメント参照）。
    includeSofusho: false,
    shinkokuKbn,
  });
}
// 中間申告（仮決算方式）の対象期間を渡した場合は SHINKOKU_KBN=2（中間）、
// 未指定（確定申告）なら既定の1（確定）を使う。
function shinkokuKbnFor(interimPeriod?: { start: string; end: string }): string {
  return interimPeriod ? '2' : '1';
}

export interface TwoWariXtxContext {
  year: number;
  businessName: string;
  filer: XtxFiler;
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
  /** 中間申告（仮決算方式）の対象期間。指定時は SHINKOKU_KBN=2（中間）で出力する */
  interimPeriod?: { start: string; end: string };
  /** 本年中に中間納付した消費税額（国税分）。確定申告出力時のみ意味を持つ */
  interimPaidNational?: Decimal;
  /** 本年中に中間納付した地方消費税額（譲渡割額）。確定申告出力時のみ意味を持つ */
  interimPaidLocal?: Decimal;
}
// 2割特例の .xtx を生成する。interimPeriod 指定時は中間申告（仮決算方式）用に
// SHINKOKU_KBN=2・対象期間を出力する（未指定は確定申告）。
export function buildTwoWariXtx(ctx: TwoWariXtxContext): string {
  const mapping = mapTwoWari({
    taxableBase10: ctx.taxableBase10,
    taxableBase8: ctx.taxableBase8,
    badDebtTax10: ctx.badDebtTax10,
    badDebtTax8: ctx.badDebtTax8,
    badDebtRecoveryTax10: ctx.badDebtRecoveryTax10,
    badDebtRecoveryTax8: ctx.badDebtRecoveryTax8,
    ...(ctx.interimPeriod ? { interimPeriod: ctx.interimPeriod } : {}),
    ...(ctx.interimPaidNational ? { interimPaidNational: ctx.interimPaidNational } : {}),
    ...(ctx.interimPaidLocal ? { interimPaidLocal: ctx.interimPaidLocal } : {}),
  });
  const forms: XtxFormInput[] = [
    {
      schema: SHA020_SCHEMA,
      values: {},
      leafValues: mapping.sha020,
      raw: mapping.sha020Raw,
    },
    {
      schema: SHB070_SCHEMA,
      values: {},
      leafValues: mapping.shb070,
    },
  ];
  return buildBundle(
    forms,
    ctx.businessName,
    ctx.filer,
    PROCEDURE_TAG_SIMPLIFIED,
    PROCEDURE_NAME_SIMPLIFIED,
    shinkokuKbnFor(ctx.interimPeriod)
  );
}

export interface SimplifiedXtxContext {
  year: number;
  businessName: string;
  filer: XtxFiler;
  taxableBase10: Decimal;
  taxableBase8: Decimal;
  /** 事業区分（第1種〜第6種）。aoiko は単一事業区分のみ対応 */
  category: SimplifiedTaxCategory;
  /** みなし仕入率。simplified-tax.ts の deemedInputRate(category) を渡す */
  deemedInputRate: number;
  /** 貸倒れに係る税額（税率別） */
  badDebtTax10: Decimal;
  badDebtTax8: Decimal;
  /** 貸倒回収に係る消費税額（税率別） */
  badDebtRecoveryTax10: Decimal;
  badDebtRecoveryTax8: Decimal;
  /** 中間申告（仮決算方式）の対象期間。指定時は SHINKOKU_KBN=2（中間）で出力する */
  interimPeriod?: { start: string; end: string };
  /** 本年中に中間納付した消費税額（国税分）。確定申告出力時のみ意味を持つ */
  interimPaidNational?: Decimal;
  /** 本年中に中間納付した地方消費税額（譲渡割額）。確定申告出力時のみ意味を持つ */
  interimPaidLocal?: Decimal;
}
// 簡易課税（単一事業区分）の .xtx を生成する。interimPeriod 指定時は中間申告
// （仮決算方式）用に SHINKOKU_KBN=2・対象期間を出力する（未指定は確定申告）。
export function buildSimplifiedXtx(ctx: SimplifiedXtxContext): string {
  const mapping = mapSimplified({
    taxableBase10: ctx.taxableBase10,
    taxableBase8: ctx.taxableBase8,
    category: ctx.category,
    deemedInputRate: ctx.deemedInputRate,
    badDebtTax10: ctx.badDebtTax10,
    badDebtTax8: ctx.badDebtTax8,
    badDebtRecoveryTax10: ctx.badDebtRecoveryTax10,
    badDebtRecoveryTax8: ctx.badDebtRecoveryTax8,
    ...(ctx.interimPeriod ? { interimPeriod: ctx.interimPeriod } : {}),
    ...(ctx.interimPaidNational ? { interimPaidNational: ctx.interimPaidNational } : {}),
    ...(ctx.interimPaidLocal ? { interimPaidLocal: ctx.interimPaidLocal } : {}),
  });
  const forms: XtxFormInput[] = [
    { schema: SHA020_SCHEMA, values: {}, leafValues: mapping.sha020, raw: mapping.sha020Raw },
    { schema: SHB047_SCHEMA, values: {}, leafValues: mapping.shb047 },
    {
      schema: SHB067_SCHEMA,
      values: {},
      leafValues: mapping.shb067,
      raw: mapping.shb067Raw,
    },
  ];
  return buildBundle(
    forms,
    ctx.businessName,
    ctx.filer,
    PROCEDURE_TAG_SIMPLIFIED,
    PROCEDURE_NAME_SIMPLIFIED,
    shinkokuKbnFor(ctx.interimPeriod)
  );
}

export interface GeneralXtxContext {
  year: number;
  businessName: string;
  filer: XtxFiler;
  taxableBase10: Decimal;
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
  /** 中間申告（仮決算方式）の対象期間。指定時は SHINKOKU_KBN=2（中間）で出力する */
  interimPeriod?: { start: string; end: string };
  /** 本年中に中間納付した消費税額（国税分）。確定申告出力時のみ意味を持つ */
  interimPaidNational?: Decimal;
  /** 本年中に中間納付した地方消費税額（譲渡割額）。確定申告出力時のみ意味を持つ */
  interimPaidLocal?: Decimal;
}
// 一般課税（本則）の .xtx を生成する。interimPeriod 指定時は中間申告（仮決算方式）
// 用に SHINKOKU_KBN=2・対象期間を出力する（未指定は確定申告）。
export function buildGeneralXtx(ctx: GeneralXtxContext): string {
  const mapping = mapGeneral({
    taxableBase10: ctx.taxableBase10,
    taxableBase8: ctx.taxableBase8,
    input10: ctx.input10,
    input8: ctx.input8,
    exportExemptSalesBase: ctx.exportExemptSalesBase,
    nonTaxableSalesBase: ctx.nonTaxableSalesBase,
    inputCommon10: ctx.inputCommon10,
    inputCommon8: ctx.inputCommon8,
    inputNonTaxableOnly10: ctx.inputNonTaxableOnly10,
    inputNonTaxableOnly8: ctx.inputNonTaxableOnly8,
    importTax10: ctx.importTax10,
    importTax8: ctx.importTax8,
    reverseChargeBase: ctx.reverseChargeBase,
    reverseChargeTax: ctx.reverseChargeTax,
    attributionMethod: ctx.attributionMethod,
    badDebtTax10: ctx.badDebtTax10,
    badDebtTax8: ctx.badDebtTax8,
    badDebtRecoveryTax10: ctx.badDebtRecoveryTax10,
    badDebtRecoveryTax8: ctx.badDebtRecoveryTax8,
    ...(ctx.interimPeriod ? { interimPeriod: ctx.interimPeriod } : {}),
    ...(ctx.interimPaidNational ? { interimPaidNational: ctx.interimPaidNational } : {}),
    ...(ctx.interimPaidLocal ? { interimPaidLocal: ctx.interimPaidLocal } : {}),
  });
  const forms: XtxFormInput[] = [
    { schema: SHA010_SCHEMA, values: {}, leafValues: mapping.sha010, raw: mapping.sha010Raw },
    { schema: SHB017_SCHEMA, values: {}, leafValues: mapping.shb017 },
    { schema: SHB033_SCHEMA, values: {}, leafValues: mapping.shb033 },
  ];
  return buildBundle(
    forms,
    ctx.businessName,
    ctx.filer,
    PROCEDURE_TAG_GENERAL,
    PROCEDURE_NAME_GENERAL,
    shinkokuKbnFor(ctx.interimPeriod)
  );
}