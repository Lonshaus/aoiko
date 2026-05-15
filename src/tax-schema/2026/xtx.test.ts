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

describe('buildXtx2026 (KOA020 schema 駆動)', () => {
  test('XML 宣言で始まる', () => {
    const x = buildXtx2026(makeCtx());
    expect(x.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  test('KOA020 ルート要素とドキュメント属性が出力される', () => {
    const x = buildXtx2026(makeCtx());
    expect(x).toMatch(/<KOA020 [^>]*VR="23\.0"/);
    expect(x).toContain('softNM="aoiko"');
  });

  test('年分が令和2桁（2026→08）で NENBUN 属性に入る', () => {
    const x = buildXtx2026(makeCtx());
    expect(x).toContain('<ABA00010 NENBUN="08"/>');
  });

  test('屋号が businessName から NOZEISHA_YAGO に入る', () => {
    const x = buildXtx2026(makeCtx());
    expect(x).toContain('<ABA00170 NOZEISHA_YAGO="青井ウェブ事務所"/>');
  });

  test('第三表〜第四表（KOA020-3..8）は出力されない', () => {
    const x = buildXtx2026(makeCtx());
    expect(x).not.toContain('<KOA020-3');
    expect(x).not.toContain('<KOA020-4');
    expect(x).not.toContain('<KOA020-8');
  });

  test('暫定の青色申告決算書セクションが含まれる（12ヶ月＋純利益）', () => {
    const x = buildXtx2026(makeCtx());
    expect(x).toContain('provisional-not-for-filing');
    const months = x.match(/<Month value="\d+"/g);
    expect(months).toHaveLength(12);
    expect(x).toContain('<NetIncome>95000</NetIncome>');
  });

  test('XML 特殊文字をエスケープする', () => {
    const ctx = makeCtx();
    ctx.businessName = 'A & B <Co>';
    const x = buildXtx2026(ctx);
    expect(x).toContain('NOZEISHA_YAGO="A &amp; B &lt;Co&gt;"');
  });

  test('整形式 XML（パース可能）', () => {
    const x = buildXtx2026(makeCtx());
    const doc = new DOMParser().parseFromString(x, 'text/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  });

  test('屋号未設定なら NOZEISHA_YAGO は出力されない', () => {
    const ctx = makeCtx();
    ctx.businessName = '';
    const x = buildXtx2026(ctx);
    expect(x).not.toContain('NOZEISHA_YAGO');
  });
});