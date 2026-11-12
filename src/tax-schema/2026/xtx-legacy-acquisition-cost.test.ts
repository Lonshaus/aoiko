import { describe, expect, test } from 'vitest';
import { buildXtx2026, type XtxContext } from './xtx';
import type { FixedAsset } from '../../db/types';
import type { PLReport } from '../../domain/reports';

function pl(netIncome: string): PLReport {
  return {
    year: 2026,
    revenue: [],
    expense: [],
    totalRevenue: netIncome,
    totalExpense: '0',
    netIncome,
    entryCount: 1,
  };
}

function ctx(overrides: Partial<XtxContext> = {}): XtxContext {
  return {
    year: 2026,
    businessName: 'テスト商店',
    invoiceNumber: '',
    monthly: { year: 2026, months: [], totalSales: '0', totalExpense: '0' },
    pl: pl('5000000'),
    bs: {
      year: 2026,
      asOf: '2026-12-31',
      assets: [],
      liabilities: [],
      equity: [],
      netIncome: '0',
      totalAssets: '0',
      totalLiabilitiesAndEquity: '0',
      balanced: true,
    },
    filer: {
      riyoshaId: '1234567890123456',
      name: '青井 太郎',
      zip: '1800001',
      address: '東京都武蔵野市1-2-3',
      zeimushoCode: '01101',
      zeimushoName: '麹町',
    },
    filingType: 'blue',
    aoiroDeductionKind: 'electronic',
    fixedAssets: [],
    ...overrides,
  };
}

function assets(count: number, extra: Partial<FixedAsset> = {}): FixedAsset[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `a${String(i).padStart(2, '0')}`,
    name: `資産${i + 1}`,
    acquisitionDate: `2025-01-${String(i + 1).padStart(2, '0')}`,
    acquisitionCost: '400000',
    usefulLifeYears: 4,
    depreciationMethod: 'straight-line' as const,
    accountCode: '1510',
    ...extra,
  }));
}

describe('旧い書き方の取得価額（R10）', () => {
  test('取得価額 0x3e8 の資産は .xtx に 1000 として書く', () => {
    const xml = buildXtx2026(ctx({ fixedAssets: assets(1, { acquisitionCost: '0x3e8' }) }));
    expect(xml).toContain('<AMF01640>1000</AMF01640>');
  });
});
