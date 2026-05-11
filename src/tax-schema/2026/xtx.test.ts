import { describe, expect, test } from 'vitest'
import { buildXtx2026, type XtxContext } from './xtx'
import type { BSReport, MonthlyReport, PLReport } from '../../domain/reports'

function makeCtx(): XtxContext {
  const monthly: MonthlyReport = {
    year: 2026,
    months: [
      { month: 1, sales: '100000', expense: '5000' },
      { month: 2, sales: '0', expense: '0' },
      { month: 3, sales: '0', expense: '0' },
      { month: 4, sales: '0', expense: '0' },
      { month: 5, sales: '0', expense: '0' },
      { month: 6, sales: '0', expense: '0' },
      { month: 7, sales: '0', expense: '0' },
      { month: 8, sales: '0', expense: '0' },
      { month: 9, sales: '0', expense: '0' },
      { month: 10, sales: '0', expense: '0' },
      { month: 11, sales: '0', expense: '0' },
      { month: 12, sales: '0', expense: '0' },
    ],
    totalSales: '100000',
    totalExpense: '5000',
  }
  const pl: PLReport = {
    year: 2026,
    revenue: [{ accountCode: '4110', accountName: '売上高', category: 'revenue', amount: '100000', displayOrder: 110 }],
    expense: [{ accountCode: '5130', accountName: '水道光熱費', category: 'expense', amount: '5000', displayOrder: 130 }],
    totalRevenue: '100000',
    totalExpense: '5000',
    netIncome: '95000',
    entryCount: 2,
  }
  const bs: BSReport = {
    year: 2026,
    asOf: '2026-12-31',
    assets: [{ accountCode: '1130', accountName: '普通預金', category: 'asset', balance: '95000' }],
    liabilities: [],
    equity: [],
    netIncome: '95000',
    totalAssets: '95000',
    totalLiabilitiesAndEquity: '95000',
    balanced: true,
  }
  return {
    year: 2026,
    businessName: '青井ウェブ事務所',
    invoiceNumber: 'T1234567890123',
    monthly,
    pl,
    bs,
  }
}

describe('buildXtx2026', () => {
  test('starts with XML declaration', () => {
    const x = buildXtx2026(makeCtx())
    expect(x.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
  })

  test('contains business name and invoice number', () => {
    const x = buildXtx2026(makeCtx())
    expect(x).toContain('<BusinessName>青井ウェブ事務所</BusinessName>')
    expect(x).toContain('<InvoiceNumber>T1234567890123</InvoiceNumber>')
  })

  test('includes 12 month rows in MonthlySales', () => {
    const x = buildXtx2026(makeCtx())
    const matches = x.match(/<Month value="\d+"/g)
    expect(matches).toHaveLength(12)
  })

  test('includes PL totals and net income', () => {
    const x = buildXtx2026(makeCtx())
    expect(x).toContain('<NetIncome>95000</NetIncome>')
  })

  test('includes BS asof + assets', () => {
    const x = buildXtx2026(makeCtx())
    expect(x).toContain('<AsOf>2026-12-31</AsOf>')
    expect(x).toContain('code="1130"')
  })

  test('escapes XML special characters', () => {
    const ctx = makeCtx()
    ctx.businessName = 'A & B <Co>'
    const x = buildXtx2026(ctx)
    expect(x).toContain('A &amp; B &lt;Co&gt;')
  })

  test('output is well-formed XML (parseable)', () => {
    const x = buildXtx2026(makeCtx())
    const parser = new DOMParser()
    const doc = parser.parseFromString(x, 'text/xml')
    const errors = doc.getElementsByTagName('parsererror')
    expect(errors).toHaveLength(0)
  })
})