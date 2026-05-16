// 令和 8 年分（2026 年度）.xtx XML 出力。
//
// 国税庁公式 W3C XSD（e-tax19）由来の schema を 2 段式 ID/IDREF 文書モデルで駆動し、
// 確定申告書（KOA020）+ 青色申告決算書一般用（KOA210）を 1 つの送信データ
// （手続 RKO0010 = 所得税及び復興特別所得税申告）に併載する。
//
// ⚠ aoiko は確定申告書本体の個人情報（氏名・住所・個人番号・各種所得控除・税額
// 計算）を収集しないため KOA020 側に入る値は年分・屋号のみ（参照側全要素
// minOccurs=0 で構造上は妥当）。決算書 KOA210 側は PL/BS/月別を対映する。
// 実申告可否は e-Tax ソフト(WEB版) での実機取込検証を経て利用者が確認すること
// （docs/xtx-spec/README.md・DISCLAIMER.md 参照）。

import type { BSReport, MonthlyReport, PLReport } from '../../domain/reports';
import koa020 from './xtx-schema-koa020.generated.json';
import koa210 from './xtx-schema-koa210.generated.json';
import type { XtxSchema } from './xtx-schema';
import { buildXtxBundle } from './xtx-document';
import { mapKoa020Values } from './xtx-mapping-koa020';
import { mapKoa210Values } from './xtx-mapping-koa210';

export interface XtxContext {
  year: number;
  businessName: string;
  invoiceNumber: string;
  monthly: MonthlyReport;
  pl: PLReport;
  bs: BSReport;
}

const KOA020_SCHEMA = koa020 as XtxSchema;
const KOA210_SCHEMA = koa210 as XtxSchema;

export function buildXtx2026(ctx: XtxContext): string {
  const creatorName =
    ctx.businessName.replace(/[\n\r\t]+/g, ' ').trim() || 'aoiko';
  return buildXtxBundle(
    [
      { schema: KOA020_SCHEMA, values: mapKoa020Values(ctx) },
      {
        schema: KOA210_SCHEMA,
        values: {},
        leafValues: mapKoa210Values(ctx.pl, ctx.bs, ctx.monthly),
      },
    ],
    {
      creatorName,
      creationDate: new Date().toISOString().slice(0, 10),
    }
  );
}