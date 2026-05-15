// 令和 8 年分（2026 年度）.xtx XML 出力。
//
// 確定申告書（KOA020 / Ver23）部分は国税庁公式仕様書から生成した
// xtx-schema.generated.json を駆動して本対応で出力する。
// ただし aoiko は確定申告書本体に必要な個人情報を収集しないため、実際に値が入るのは
// 年分・屋号のみ（KOA020 第一表/第二表は全要素 minOccurs=0 なので構造上は妥当）。
//
// 損益計算書・貸借対照表・月別売上は青色申告決算書（別様式）の領域で、こちらは
// Sub 3（#36）まで暫定の自己記述形式のまま。実申告には使用不可。
//
// 名前空間 URI：仕様書 xlsx には prefix「shotoku」のみ記載で完全 URI は未記載。
// 正式な名前空間宣言は .xtx パッケージング（Sub 4 / #37）で確定する。

import type { BSReport, MonthlyReport, PLReport } from '../../domain/reports';
import schemaJson from './xtx-schema.generated.json';
import type { XtxElement, XtxSchema } from './xtx-schema';
import { KOA020_MAPPING } from './xtx-mapping-koa020';

export interface XtxContext {
  year: number;
  businessName: string;
  invoiceNumber: string;
  monthly: MonthlyReport;
  pl: PLReport;
  bs: BSReport;
}

const schema = schemaJson as XtxSchema;

interface TreeNode {
  el: XtxElement;
  children: TreeNode[];
}

// フラットな要素列（level 3..12）を level でネスト木に再構成する。
function buildTree(elements: XtxElement[]): TreeNode | null {
  let root: TreeNode | null = null;
  const stack: TreeNode[] = [];
  for (const el of elements) {
    const node: TreeNode = { el, children: [] };
    while (stack.length > 0 && stack[stack.length - 1]!.el.level >= el.level) {
      stack.pop();
    }
    if (stack.length === 0) {
      root = node;
    } else {
      stack[stack.length - 1]!.children.push(node);
    }
    stack.push(node);
  }
  return root;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeAttr(s: string): string {
  return escapeXml(s);
}

// KOA020 第一表/第二表のみ対象（第三表＝分離課税・第四表＝損失申告は個人事業主の
// 通常申告では不要なので出力しない）。
const SUPPORTED_FORM_TAGS = new Set(['KOA020-1', 'KOA020-2']);

interface RenderResult {
  xml: string;
  hasContent: boolean;
}

function renderNode(
  node: TreeNode,
  ctx: XtxContext,
  indent: string
): RenderResult {
  const { el } = node;
  const tag = el.tag;
  // leaf：attrName を持ち、マッピングが値を返したときのみ出力
  if (el.attrName) {
    const resolver = KOA020_MAPPING[tag];
    const value = resolver ? resolver(ctx) : undefined;
    if (value === undefined || value === '') {
      return { xml: '', hasContent: false };
    }
    return {
      xml: `${indent}<${tag} ${el.attrName}="${escapeAttr(value)}"/>`,
      hasContent: true,
    };
  }
  // wrapper：子に出力対象があるときのみ自身を出力
  const childXml: string[] = [];
  let any = false;
  for (const child of node.children) {
    if (
      child.el.level === 4 &&
      child.el.tag.startsWith('KOA020-') &&
      !SUPPORTED_FORM_TAGS.has(child.el.tag)
    ) {
      continue;
    }
    const r = renderNode(child, ctx, indent + '  ');
    if (r.hasContent) {
      childXml.push(r.xml);
      any = true;
    }
  }
  if (!any) {
    return { xml: '', hasContent: false };
  }
  const open =
    el.level === 3
      ? `${indent}<${tag}${rootAttrs(ctx)}>`
      : `${indent}<${tag}>`;
  return {
    xml: `${open}\n${childXml.join('\n')}\n${indent}</${tag}>`,
    hasContent: true,
  };
}

// ルート KOA020 のドキュメント属性（page / VR / softNM / sakuseiNM / sakuseiDay）。
function rootAttrs(ctx: XtxContext): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const attrs: Array<[string, string]> = [
    ['VR', schema.meta.version],
    ['id', schema.meta.formId],
    ['page', '1'],
    ['softNM', 'aoiko'],
    ['sakuseiNM', escapeAttr(ctx.businessName)],
    ['sakuseiDay', today],
  ];
  return ' ' + attrs.map(([k, v]) => `${k}="${v}"`).join(' ');
}

// 青色申告決算書（PL/BS/月別）— Sub 3 まで暫定形式。実申告利用不可。
function buildProvisionalDecisionSheet(ctx: XtxContext): string {
  const lines: string[] = [];
  lines.push(
    '  <!-- TODO(#36): 青色申告決算書は別様式・暫定形式。実 .xtx 仕様未対応 -->'
  );
  lines.push('  <DraftDecisionSheet note="provisional-not-for-filing">');
  lines.push('    <MonthlySales>');
  for (const mo of ctx.monthly.months) {
    lines.push(
      `      <Month value="${mo.month}" sales="${mo.sales}" expense="${mo.expense}"/>`
    );
  }
  lines.push(
    `      <YearTotal sales="${ctx.monthly.totalSales}" expense="${ctx.monthly.totalExpense}"/>`
  );
  lines.push('    </MonthlySales>');
  lines.push('    <ProfitAndLoss>');
  for (const r of ctx.pl.revenue) {
    lines.push(
      `      <Revenue code="${r.accountCode}" name="${escapeXml(r.accountName)}" amount="${r.amount}"/>`
    );
  }
  for (const r of ctx.pl.expense) {
    lines.push(
      `      <Expense code="${r.accountCode}" name="${escapeXml(r.accountName)}" amount="${r.amount}"/>`
    );
  }
  lines.push(`      <NetIncome>${ctx.pl.netIncome}</NetIncome>`);
  lines.push('    </ProfitAndLoss>');
  lines.push('    <BalanceSheet>');
  lines.push(`      <AsOf>${ctx.bs.asOf}</AsOf>`);
  for (const r of ctx.bs.assets) {
    lines.push(
      `      <Asset code="${r.accountCode}" name="${escapeXml(r.accountName)}" amount="${r.balance}"/>`
    );
  }
  for (const r of ctx.bs.liabilities) {
    lines.push(
      `      <Liability code="${r.accountCode}" name="${escapeXml(r.accountName)}" amount="${r.balance}"/>`
    );
  }
  for (const r of ctx.bs.equity) {
    lines.push(
      `      <Equity code="${r.accountCode}" name="${escapeXml(r.accountName)}" amount="${r.balance}"/>`
    );
  }
  lines.push('    </BalanceSheet>');
  lines.push('  </DraftDecisionSheet>');
  return lines.join('\n');
}

export function buildXtx2026(ctx: XtxContext): string {
  const tree = buildTree(schema.elements);
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<!-- aoiko .xtx 出力 / 様式 ${schema.meta.formId} Ver${schema.meta.version}` +
      ` / 名前空間 prefix=${schema.meta.namespace}（完全 URI は Sub 4 で確定） -->`
  );
  lines.push('<AoikoXtx>');
  if (tree) {
    const r = renderNode(tree, ctx, '  ');
    if (r.hasContent) {
      lines.push(r.xml);
    } else {
      lines.push(
        `  <!-- KOA020: マッピング可能な値なし（年分・屋号未設定） -->`
      );
    }
  }
  lines.push(buildProvisionalDecisionSheet(ctx));
  lines.push('</AoikoXtx>');
  return lines.join('\n');
}