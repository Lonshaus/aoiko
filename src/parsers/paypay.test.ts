import { describe, expect, test } from 'vitest'
import { paypayParser } from './paypay'
import sample from './fixtures/paypay-sample.csv?raw'

describe('paypayParser', () => {
  test('metadata', () => {
    expect(paypayParser.name).toBe('paypay')
    expect(paypayParser.accountCode).toBe('1130')
    expect(paypayParser.encoding).toBe('utf-8')
  })

  test('parses sign-based debit/credit sample fixture', () => {
    const r = paypayParser.parse(sample)
    expect(r).toHaveLength(4)

    expect(r[0]).toMatchObject({
      description: 'チャージ',
      amount: '10000',
      side: 'debit',
    })
    expect(r[1]).toMatchObject({
      description: '支払',
      amount: '1500',
      side: 'credit',
    })
    expect(r[2]?.side).toBe('debit')   // 入金（送金受取）
    expect(r[3]?.side).toBe('credit')  // 支払
  })

  test('handles ¥ and full-width yen prefix', () => {
    const csv =
      '"取引日","取引内容","取引金額(円)","残高(円)","出金元/入金先"\n' +
      '"2026/05/01","チャージ","¥5,000","5,000",""\n' +
      '"2026/05/02","支払","-￥1,000","4,000",""'
    const r = paypayParser.parse(csv)
    expect(r[0]?.amount).toBe('5000')
    expect(r[0]?.side).toBe('debit')
    expect(r[1]?.amount).toBe('1000')
    expect(r[1]?.side).toBe('credit')
  })
})