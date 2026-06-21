import { describe, expect, test } from 'vitest';
import { buildXtx2026, type XtxContext } from './xtx';
import type { BSReport, MonthlyReport, PLReport } from '../../domain/reports';

function makeCtx(): XtxContext {
  const monthly: MonthlyReport = {
    year: 2026,
    months: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      sales: '0',
      expense: '0',
    })),
    totalSales: '0',
    totalExpense: '0',
  };
  const pl: PLReport = {
    year: 2026,
    revenue: [],
    expense: [],
    totalRevenue: '0',
    totalExpense: '0',
    netIncome: '0',
    entryCount: 0,
  };
  const bs: BSReport = {
    year: 2026,
    asOf: '2026-12-31',
    assets: [],
    liabilities: [],
    equity: [],
    netIncome: '0',
    totalAssets: '0',
    totalLiabilitiesAndEquity: '0',
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

describe('buildXtx2026 (KOA020+KOA210 併載 / 2 段式モデル駆動)', () => {
  test('エンベロープ骨格を持つ（手続 RKO0010）', () => {
    const x = buildXtx2026(makeCtx());
    expect(x).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(x).toContain('<DATA id="DATA">');
    expect(x).toContain('<RKO0010 VR="25.0.0" id="手続ID">');
    expect(x).toContain('<CONTENTS id="CONTENTS">');
    expect(x).toContain('<IT VR="1.0" id="IT">');
  });

  test('1 エンベロープに申告書 KOA020 と決算書 KOA210 を併載', () => {
    const x = buildXtx2026(makeCtx());
    expect(x).toMatch(/<KOA020 VR="23\.0"/);
    expect(x).toMatch(/<KOA210 VR="11\.0"/);
    // CONTENTS / IT部 は 1 つだけ
    expect(x.match(/<CONTENTS id="CONTENTS">/g)).toHaveLength(1);
    expect(x.match(/<IT VR="1\.0" id="IT">/g)).toHaveLength(1);
  });

  test('年分が令和（2026→8）で定義側 NENBUN に入る', () => {
    const x = buildXtx2026(makeCtx());
    expect(x).toContain('<NENBUN ID="NENBUN">8</NENBUN>');
  });

  test('屋号が businessName から NOZEISHA_YAGO に入る', () => {
    const x = buildXtx2026(makeCtx());
    expect(x).toContain(
      '<NOZEISHA_YAGO ID="NOZEISHA_YAGO">青井ウェブ事務所</NOZEISHA_YAGO>'
    );
  });

  test('参照側ルートは KOA020＋FormAttribute', () => {
    const x = buildXtx2026(makeCtx());
    expect(x).toMatch(/<KOA020 VR="23\.0" softNM="aoiko"/);
    expect(x).toContain('sakuseiNM="青井ウェブ事務所"');
  });

  test('参照側 IDREF が定義側 ID に解決する', () => {
    const x = buildXtx2026(makeCtx());
    const ids = new Set(
      [...x.matchAll(/\sID="([A-Z_0-9]+)"/g)].map((m) => m[1])
    );
    const idrefs = [...x.matchAll(/\sIDREF="([A-Z_0-9]+)"/g)].map(
      (m) => m[1]
    );
    expect(idrefs.length).toBeGreaterThan(0);
    for (const r of idrefs) {
      expect(ids.has(r)).toBe(true);
    }
  });

  test('整形式 XML（パース可能）', () => {
    const x = buildXtx2026(makeCtx());
    const doc = new DOMParser().parseFromString(x, 'text/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  });

  test('XML 特殊文字をエスケープ', () => {
    const ctx = makeCtx();
    ctx.businessName = 'A & B <Co>';
    const x = buildXtx2026(ctx);
    expect(x).toContain(
      '<NOZEISHA_YAGO ID="NOZEISHA_YAGO">A &amp; B &lt;Co&gt;</NOZEISHA_YAGO>'
    );
  });

  test('屋号未設定なら NOZEISHA_YAGO は出力されない', () => {
    const ctx = makeCtx();
    ctx.businessName = '';
    const x = buildXtx2026(ctx);
    expect(x).not.toContain('NOZEISHA_YAGO');
  });
});