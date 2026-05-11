import { describe, expect, test } from 'vitest'
import { rakutenCardParser } from './rakuten-card'
import sample from './fixtures/rakuten-card-sample.csv?raw'

describe('rakutenCardParser', () => {
  test('metadata', () => {
    expect(rakutenCardParser.name).toBe('rakuten-card')
    expect(rakutenCardParser.accountCode).toBe('2120')
    expect(rakutenCardParser.encoding).toBe('shift_jis')
  })

  test('parses sample fixture; all rows are credit (未払金 増)', () => {
    const r = rakutenCardParser.parse(sample)
    expect(r).toHaveLength(3)
    for (const tx of r) {
      expect(tx.side).toBe('credit')
    }
    expect(r[0]?.description).toBe('amazon.co.jp')
    expect(r[0]?.amount).toBe('2500')
    expect(r[1]?.amount).toBe('8800')
  })

  test('omits memo for default 本人 / 1回', () => {
    const r = rakutenCardParser.parse(sample)
    expect(r[0]?.memo).toBeUndefined()
  })

  test('keeps memo for non-default user / payment method', () => {
    const csv =
      '"利用日","利用店名・商品名","利用者","支払方法","利用金額","支払手数料","支払総額"\n' +
      '"2026/05/01","ヨドバシ","家族","3回","30,000","0","30,000"'
    const r = rakutenCardParser.parse(csv)
    expect(r[0]?.memo).toBe('家族 / 3回')
  })
})