import { describe, expect, test } from 'vitest'
import { paypayParser } from './paypay'
import sample from './fixtures/paypay-sample.csv?raw'

describe('paypayParser', () => {
  test('metadata: クレジット運用前提で未払金(2120)', () => {
    expect(paypayParser.name).toBe('paypay')
    expect(paypayParser.accountCode).toBe('2120')
    expect(paypayParser.encoding).toBe('utf-8')
  })

  test('ポイント獲得入金は除外、支払いは credit、返金入金は debit で取込', () => {
    const r = paypayParser.parse(sample)
    expect(r).toHaveLength(3)
    expect(r[0]).toMatchObject({
      date: '2026-03-28',
      description: '飲食店チェーン - 吉祥寺店',
      amount: '9500',
      side: 'credit',
      memo: 'クレジット VISA 0000',
    })
    expect(r[1]).toMatchObject({
      date: '2026-03-30',
      amount: '1200',
      description: 'コンビニ店',
      side: 'credit',
    })
    // 返金入金は未払金の減少（debit）
    expect(r[2]).toMatchObject({
      date: '2026-03-31',
      amount: '3000',
      side: 'debit',
      memo: 'クレジット VISA 0000 / 返金',
    })
  })

  test("'-' は空値として扱う", () => {
    const csv =
      '取引日,出金金額（円）,入金金額（円）,取引内容,取引先,取引方法\n' +
      '2026/04/01 10:00:00,-,500,ポイント、残高の獲得,X,PayPayポイント'
    expect(paypayParser.parse(csv)).toEqual([])
  })

  test('throws on unrecognized header', () => {
    const csv = '"DATE","OUT","DEST"\n"2026/05/01","100","x"'
    expect(() => paypayParser.parse(csv)).toThrow(/CSV ヘッダー形式/)
  })
})