// 令和 8 年分（2026 年度）青色申告決算書 + 確定申告書 B 用の .xtx XML 出力。
//
// ⚠ 現状は仮実装：実際の .xtx は 国税庁公開の XSD に厳密に従う必要があるが、
// 公式 XSD との突合は未完了。要素名・名前空間・順序すべて要検証。
//
// 検証 TODO（Phase 2 残作業）：
//   - 国税庁の e-Tax 関連様式 XSD をダウンロード（https://www.e-tax.nta.go.jp/）
//   - 確定申告書 B 用 + 青色申告決算書（一般用）用の 2 つの様式を確認
//   - 要素名（現在の英語仮名 vs 実際の漢字仮名）を置換
//   - 名前空間・スキーマ宣言を追加
//   - e-Taxソフト(WEB版) で実際に読み込めることを確認

import type { BSReport, MonthlyReport, PLReport } from '../../domain/reports';

export interface XtxContext {
  year: number;
  businessName: string;
  invoiceNumber: string;
  monthly: MonthlyReport;
  pl: PLReport;
  bs: BSReport;
}

export function buildXtx2026(ctx: XtxContext): string {
  // XSD 整合済むまで「自己記述的な暫定形式」で出力する。
  // 各 element の意味を日本語コメントで明示し、後で実 XSD に置換するのを容易にする。

  const escape = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<!-- TODO: 国税庁公式 XSD と照合し、要素名・名前空間を確定する -->');
  lines.push(`<TaxReturn year="${ctx.year}" formType="aoiko-2026-draft">`);

  lines.push('  <Taxpayer>');
  lines.push(`    <BusinessName>${escape(ctx.businessName)}</BusinessName>`);
  if (ctx.invoiceNumber) {
    lines.push(`    <InvoiceNumber>${escape(ctx.invoiceNumber)}</InvoiceNumber>`);
  }
  lines.push('  </Taxpayer>');

  // 月別売上（売上高の月内訳）
  lines.push('  <MonthlySales>');
  for (const m of ctx.monthly.months) {
    lines.push(
      `    <Month value="${m.month}" sales="${m.sales}" expense="${m.expense}"/>`
    );
  }
  lines.push(`    <YearTotal sales="${ctx.monthly.totalSales}" expense="${ctx.monthly.totalExpense}"/>`);
  lines.push('  </MonthlySales>');

  // 損益計算書
  lines.push('  <ProfitAndLoss>');
  lines.push('    <Revenue>');
  for (const r of ctx.pl.revenue) {
    lines.push(
      `      <Item code="${r.accountCode}" name="${escape(r.accountName)}" amount="${r.amount}"/>`
    );
  }
  lines.push(`      <Total>${ctx.pl.totalRevenue}</Total>`);
  lines.push('    </Revenue>');
  lines.push('    <Expense>');
  for (const r of ctx.pl.expense) {
    lines.push(
      `      <Item code="${r.accountCode}" name="${escape(r.accountName)}" amount="${r.amount}"/>`
    );
  }
  lines.push(`      <Total>${ctx.pl.totalExpense}</Total>`);
  lines.push('    </Expense>');
  lines.push(`    <NetIncome>${ctx.pl.netIncome}</NetIncome>`);
  lines.push('  </ProfitAndLoss>');

  // 貸借対照表
  lines.push('  <BalanceSheet>');
  lines.push(`    <AsOf>${ctx.bs.asOf}</AsOf>`);
  lines.push('    <Assets>');
  for (const r of ctx.bs.assets) {
    lines.push(
      `      <Item code="${r.accountCode}" name="${escape(r.accountName)}" amount="${r.balance}"/>`
    );
  }
  lines.push(`      <Total>${ctx.bs.totalAssets}</Total>`);
  lines.push('    </Assets>');
  lines.push('    <Liabilities>');
  for (const r of ctx.bs.liabilities) {
    lines.push(
      `      <Item code="${r.accountCode}" name="${escape(r.accountName)}" amount="${r.balance}"/>`
    );
  }
  lines.push('    </Liabilities>');
  lines.push('    <Equity>');
  for (const r of ctx.bs.equity) {
    lines.push(
      `      <Item code="${r.accountCode}" name="${escape(r.accountName)}" amount="${r.balance}"/>`
    );
  }
  lines.push(`      <NetIncome>${ctx.bs.netIncome}</NetIncome>`);
  lines.push('    </Equity>');
  lines.push(`    <LiabilitiesAndEquityTotal>${ctx.bs.totalLiabilitiesAndEquity}</LiabilitiesAndEquityTotal>`);
  lines.push('  </BalanceSheet>');

  lines.push('</TaxReturn>');
  return lines.join('\n');
}