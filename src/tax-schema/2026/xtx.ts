// 令和 8 年分（2026 年度）.xtx XML 出力。
//
// 国税庁公式 W3C XSD（e-tax19）由来の schema を 2 段式 ID/IDREF 文書モデルで駆動し、
// 確定申告書（KOA020）+ 決算書・収支内訳書を 1 つの送信データ
// （手続 RKO0010 = 所得税及び復興特別所得税申告）に併載する。青色申告は
// 青色申告決算書一般用（KOA210）、白色申告は収支内訳書一般用（KOA110）を同梱する。
//
// ⚠ aoiko は事業の損益のみを扱う。確定申告書 KOA020 に載るのは「事業」部分
// （営業等収入・事業所得・（青色申告のみ）青色申告特別控除）と申告者情報（IT部 必須）まで。
// 各種所得控除・税額計算は本人情報が必要なため載せず、利用者が e-Tax 上で補完する。
// 決算書・収支内訳書側は PL/BS/月別を対映する。実申告可否は e-Taxソフト(DL版) での
// 実機取込検証を経て利用者が確認すること（docs/xtx-spec/README.md・DISCLAIMER.md 参照）。

import type { BSReport, MonthlyReport, PLReport } from '../../domain/reports';
import type { FixedAsset } from '../../db/types';
import koa020 from './xtx-schema-koa020.generated.json';
import koa210 from './xtx-schema-koa210.generated.json';
import koa110 from './xtx-schema-koa110.generated.json';
import type { XtxSchema } from './xtx-schema';
import { buildXtxBundle, type XtxFilerInfo, type XtxFormInput } from './xtx-document';
import { todayISO } from '../../lib/date';
import type { AoiroDeductionKind } from './aoiro-deduction';
import { mapKoa020LeafValues, mapKoa020Values } from './xtx-mapping-koa020';
import { mapKoa210Values } from './xtx-mapping-koa210';
import { mapKoa110Values, mapKoa110RepeatedValues } from './xtx-mapping-koa110';
// 申告者情報（e-Tax 提出用）。IT部 定義側の必須・任意項目に対映する。
export interface XtxFiler {
  riyoshaId: string;       // 利用者識別番号（16桁）
  name: string;            // 氏名・名称
  zip: string;             // 郵便番号（7桁・ハイフン無し）
  address: string;         // 住所
  zeimushoCode: string;    // 提出先税務署コード（5桁）
  zeimushoName: string;    // 提出先税務署名
}
// 確定申告方式。青色申告特別控除・決算書の様式（KOA210/KOA110）に影響する。
export type FilingType = 'blue' | 'white';

export interface XtxContext {
  year: number;
  businessName: string;
  invoiceNumber: string;
  monthly: MonthlyReport;
  pl: PLReport;
  bs: BSReport;
  filer: XtxFiler;
  filingType: FilingType;
  aoiroDeductionKind: AoiroDeductionKind;
  /** 白色申告の収支内訳書 第2頁（減価償却資産の明細）用。青色申告時は未使用 */
  fixedAssets: FixedAsset[];
}

const KOA020_SCHEMA = koa020 as XtxSchema;
const KOA210_SCHEMA = koa210 as XtxSchema;
const KOA110_SCHEMA = koa110 as XtxSchema;

export function toFilerInfo(f: XtxFiler): XtxFilerInfo {
  return {
    zeimushoCode: f.zeimushoCode,
    zeimushoName: f.zeimushoName,
    riyoshaId: f.riyoshaId,
    name: f.name,
    zip: f.zip,
    address: f.address,
  };
}

export function buildXtx2026(ctx: XtxContext): string {
  const creatorName =
    ctx.businessName.replace(/[\n\r\t]+/g, ' ').trim() || 'aoiko';
  const statementForm: XtxFormInput =
    ctx.filingType === 'white'
      ? {
          schema: KOA110_SCHEMA,
          values: {},
          leafValues: mapKoa110Values(ctx),
          repeats: mapKoa110RepeatedValues(ctx),
        }
      : { schema: KOA210_SCHEMA, values: {}, leafValues: mapKoa210Values(ctx) };
  return buildXtxBundle(
    [
      {
        schema: KOA020_SCHEMA,
        values: mapKoa020Values(ctx),
        leafValues: mapKoa020LeafValues(ctx),
      },
      statementForm,
    ],
    {
      creatorName,
      creationDate: todayISO(),
      filer: toFilerInfo(ctx.filer),
    }
  );
}