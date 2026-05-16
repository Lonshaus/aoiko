// 令和 8 年分（2026 年度）.xtx XML 出力。
//
// 国税庁公式 W3C XSD（e-tax19）由来の schema を Sub B の 2 段式 ID/IDREF 文書
// モデル（buildXtxDocument）で駆動する。本ファイルは KOA020（確定申告書）の対映を
// 担当（Sub C）。青色申告決算書 KOA210（PL/BS/月別）の対映は Sub D で追加する。
//
// ⚠ aoiko は確定申告書本体に必要な個人情報を収集しないため、出力に値が入るのは
// 年分・屋号のみ（参照側全要素 minOccurs=0 で構造上は妥当）。実申告可否は Sub E の
// e-Tax 実機検証まで未確定。

import type { BSReport, MonthlyReport, PLReport } from '../../domain/reports';
import koa020 from './xtx-schema-koa020.generated.json';
import type { XtxSchema } from './xtx-schema';
import { buildXtxDocument } from './xtx-document';
import { mapKoa020Values } from './xtx-mapping-koa020';

export interface XtxContext {
  year: number;
  businessName: string;
  invoiceNumber: string;
  monthly: MonthlyReport;
  pl: PLReport;
  bs: BSReport;
}

const KOA020_SCHEMA = koa020 as XtxSchema;

export function buildXtx2026(ctx: XtxContext): string {
  const values = mapKoa020Values(ctx);
  return buildXtxDocument(KOA020_SCHEMA, values, {
    creatorName: ctx.businessName.replace(/[\n\r\t]+/g, ' ').trim() || 'aoiko',
    creationDate: new Date().toISOString().slice(0, 10),
  });
}