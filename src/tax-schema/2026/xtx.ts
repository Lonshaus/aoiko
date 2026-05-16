// 令和 8 年分（2026 年度）.xtx XML 出力。
//
// ⚠ 移行中（Sub A 完了時点）：schema 源を国税庁公式 W3C XSD（e-tax19）へ切替済。
// 真の e-Tax .xtx は 2 段式 ID/IDREF モデル（参照側=帳票個別部分 + 定義側=IT部 +
// エンベロープ）。その文書モデル核は Sub B、KOA020/KOA210 の業務対映は Sub C/D で実装する。
//
// 本ファイルは移行期間のプレースホルダ。Reports 画面の導線維持のため buildXtx2026 の
// シグネチャは保つが、出力は実申告に使えない暫定の自己記述形式のみ
// （schema 駆動の本対応出力は Sub C/D で置換）。

import type { BSReport, MonthlyReport, PLReport } from '../../domain/reports';

export interface XtxContext {
  year: number;
  businessName: string;
  invoiceNumber: string;
  monthly: MonthlyReport;
  pl: PLReport;
  bs: BSReport;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildXtx2026(ctx: XtxContext): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<!-- 移行中：schema 源は e-tax19 XSD へ切替済。2 段式 ID/IDREF 本対応は Sub B/C/D。' +
      ' 本出力は暫定形式・実申告利用不可 -->'
  );
  lines.push('<AoikoXtxDraft note="provisional-not-for-filing">');
  lines.push(
    `  <Business name="${escapeXml(ctx.businessName)}" year="${ctx.year}"/>`
  );
  lines.push('  <MonthlySales>');
  for (const mo of ctx.monthly.months) {
    lines.push(
      `    <Month value="${mo.month}" sales="${mo.sales}" expense="${mo.expense}"/>`
    );
  }
  lines.push(
    `    <YearTotal sales="${ctx.monthly.totalSales}" expense="${ctx.monthly.totalExpense}"/>`
  );
  lines.push('  </MonthlySales>');
  lines.push('  <ProfitAndLoss>');
  for (const r of ctx.pl.revenue) {
    lines.push(
      `    <Revenue code="${r.accountCode}" name="${escapeXml(r.accountName)}" amount="${r.amount}"/>`
    );
  }
  for (const r of ctx.pl.expense) {
    lines.push(
      `    <Expense code="${r.accountCode}" name="${escapeXml(r.accountName)}" amount="${r.amount}"/>`
    );
  }
  lines.push(`    <NetIncome>${ctx.pl.netIncome}</NetIncome>`);
  lines.push('  </ProfitAndLoss>');
  lines.push('  <BalanceSheet>');
  lines.push(`    <AsOf>${ctx.bs.asOf}</AsOf>`);
  for (const r of ctx.bs.assets) {
    lines.push(
      `    <Asset code="${r.accountCode}" name="${escapeXml(r.accountName)}" amount="${r.balance}"/>`
    );
  }
  for (const r of ctx.bs.liabilities) {
    lines.push(
      `    <Liability code="${r.accountCode}" name="${escapeXml(r.accountName)}" amount="${r.balance}"/>`
    );
  }
  for (const r of ctx.bs.equity) {
    lines.push(
      `    <Equity code="${r.accountCode}" name="${escapeXml(r.accountName)}" amount="${r.balance}"/>`
    );
  }
  lines.push('  </BalanceSheet>');
  lines.push('</AoikoXtxDraft>');
  return lines.join('\n');
}