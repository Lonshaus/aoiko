import { describe, expect, test } from 'vitest';
import { buildXtx2026, type XtxContext } from './xtx';
import type { BSReport, MonthlyReport, PLReport } from '../../domain/reports';

function makeCtx(): XtxContext {
  const monthly: MonthlyReport = {
    year: 2026,
    months: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      sales: i === 0 ? '100000' : '0',
      expense: i === 0 ? '5000' : '0',
    })),
    totalSales: '100000',
    totalExpense: '5000',
  };
  const pl: PLReport = {
    year: 2026,
    revenue: [
      {
        accountCode: '4110',
        accountName: '売上高',
        category: 'revenue',
        amount: '100000',
        displayOrder: 110,
      },
    ],
    expense: [
      {
        accountCode: '5130',
        accountName: '水道光熱費',
        category: 'expense',
        amount: '5000',
        displayOrder: 130,
      },
    ],
    totalRevenue: '100000',
    totalExpense: '5000',
    netIncome: '95000',
    entryCount: 2,
  };
  const bs: BSReport = {
    year: 2026,
    asOf: '2026-12-31',
    assets: [
      {
        accountCode: '1130',
        accountName: '普通預金',
        category: 'asset',
        balance: '95000',
      },
    ],
    liabilities: [],
    equity: [],
    netIncome: '95000',
    totalAssets: '95000',
    totalLiabilitiesAndEquity: '95000',
    balanced: true,
  };
  return {
    year: 2026,
    businessName: '青井ウェブ事務所',
    invoiceNumber: 'T1234567890123',
    monthly,
    pl,
    bs,
  };
}

// Sub A 時点：xtx.ts は移行期プレースホルダ（暫定形式・実申告不可）。
// schema 駆動の 2 段式本対応出力は Sub B/C/D で置換され、本テストもその時更新する。
describe('buildXtx2026 (移行期プレースホルダ)', () => {
  test('XML 宣言で始まる', () => {
    expect(buildXtx2026(makeCtx())).toMatch(
      /^<\?xml version="1\.0" encoding="UTF-8"\?>/
    );
  });

  test('実申告不可マークを含む', () => {
    expect(buildXtx2026(makeCtx())).toContain('provisional-not-for-filing');
  });

  test('事業者名・年・12ヶ月・純利益を含む', () => {
    const x = buildXtx2026(makeCtx());
    expect(x).toContain('name="青井ウェブ事務所"');
    expect(x).toContain('year="2026"');
    expect(x.match(/<Month value="\d+"/g)).toHaveLength(12);
    expect(x).toContain('<NetIncome>95000</NetIncome>');
  });

  test('XML 特殊文字をエスケープする', () => {
    const ctx = makeCtx();
    ctx.businessName = 'A & B <Co>';
    expect(buildXtx2026(ctx)).toContain('name="A &amp; B &lt;Co&gt;"');
  });

  test('整形式 XML（パース可能）', () => {
    const x = buildXtx2026(makeCtx());
    const doc = new DOMParser().parseFromString(x, 'text/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  });
});