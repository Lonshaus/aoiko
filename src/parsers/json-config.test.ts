import { describe, expect, test } from 'vitest'
import { defineParser, type JsonParserConfig } from './json-config'

const SAMPLE_BANK_CSV =
  '"日付","摘要","出金","入金","残高"\n' +
  '"2026/05/01","給与振込","","300,000","450,000"\n' +
  '"2026/05/02","電気代","8,500","","441,500"'

describe('defineParser - bank-style', () => {
  test('parses withdrawal/deposit columns', () => {
    const config: JsonParserConfig = {
      name: 'test-bank',
      displayName: 'テスト銀行',
      accountCode: '1130',
      encoding: 'utf-8',
      columns: {
        date: { header: '日付' },
        description: { header: '摘要' },
        withdrawal: { header: '出金' },
        deposit: { header: '入金' },
        balance: { header: '残高' },
      },
    }
    const parser = defineParser(config)
    const r = parser.parse(SAMPLE_BANK_CSV)
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({
      date: '2026-05-01',
      description: '給与振込',
      amount: '300000',
      side: 'debit',
      balance: '450000',
    })
    expect(r[1]).toMatchObject({
      amount: '8500',
      side: 'credit',
    })
  })
})

describe('defineParser - card-style', () => {
  test('all rows take fixed side', () => {
    const csv =
      '"利用日","店名","金額"\n' +
      '"2026/05/01","amazon","2,500"\n' +
      '"2026/05/02","AWS","8,800"'
    const config: JsonParserConfig = {
      name: 'test-card',
      displayName: 'テストカード',
      accountCode: '2120',
      encoding: 'shift_jis',
      columns: {
        date: { header: '利用日' },
        description: { header: '店名' },
        amount: { header: '金額', side: 'credit' },
      },
    }
    const parser = defineParser(config)
    const r = parser.parse(csv)
    expect(r).toHaveLength(2)
    expect(r.every((t) => t.side === 'credit')).toBe(true)
    expect(r[1]?.amount).toBe('8800')
  })
})

describe('defineParser - signed-amount', () => {
  test('determines side by sign', () => {
    const csv =
      '"取引日","内容","金額"\n' +
      '"2026/05/01","チャージ","5,000"\n' +
      '"2026/05/02","支払","-1,500"\n' +
      '"2026/05/03","支払","-￥800"'
    const config: JsonParserConfig = {
      name: 'test-signed',
      displayName: 'テスト電子マネー',
      accountCode: '1130',
      encoding: 'utf-8',
      columns: {
        date: { header: '取引日' },
        description: { header: '内容' },
        signedAmount: { header: '金額' },
      },
    }
    const parser = defineParser(config)
    const r = parser.parse(csv)
    expect(r).toHaveLength(3)
    expect(r[0]?.side).toBe('debit')
    expect(r[0]?.amount).toBe('5000')
    expect(r[1]?.side).toBe('credit')
    expect(r[1]?.amount).toBe('1500')
    expect(r[2]?.side).toBe('credit')
    expect(r[2]?.amount).toBe('800')
  })
})

describe('defineParser - errors', () => {
  test('throws on missing required column', () => {
    const config: JsonParserConfig = {
      name: 'broken',
      displayName: 'broken',
      accountCode: '1130',
      encoding: 'utf-8',
      columns: {
        date: { header: '日付' },
        description: { header: '摘要' },
        withdrawal: { header: '出金' },
        deposit: { header: '入金' },
      },
    }
    const parser = defineParser(config)
    const csv = '"日付","摘要","出金"\n"2026/05/01","x","100"'
    expect(() => parser.parse(csv)).toThrow(/CSV ヘッダー形式/)
  })
})

describe('defineParser - description fallback', () => {
  test('uses fallback header when primary is empty', () => {
    const csv =
      '"日付","摘要","摘要内容","出金","入金"\n' +
      '"2026/05/01","","詳細だけある","","100"\n' +
      '"2026/05/02","摘要あり","","","200"'
    const config: JsonParserConfig = {
      name: 'fb',
      displayName: 'fb',
      accountCode: '1130',
      encoding: 'utf-8',
      columns: {
        date: { header: '日付' },
        description: { header: '摘要', fallbackHeader: '摘要内容' },
        withdrawal: { header: '出金' },
        deposit: { header: '入金' },
      },
    }
    const parser = defineParser(config)
    const r = parser.parse(csv)
    expect(r[0]?.description).toBe('詳細だけある')
    expect(r[1]?.description).toBe('摘要あり')
  })
})