import { describe, expect, test } from 'vitest'
import { auPayCardParser } from './aupay-card'
import sample from './aupay-card-sample.csv?raw'

describe('auPayCardParser', () => {
  test('metadata', () => {
    expect(auPayCardParser.name).toBe('aupay-card')
    expect(auPayCardParser.displayName).toBe('au PAY カード')
    expect(auPayCardParser.accountCode).toBe('2120')
    expect(auPayCardParser.encoding).toBe('shift_jis')
  })

  test('parses sample fixture; all rows credit', () => {
    const r = auPayCardParser.parse(sample)
    expect(r).toHaveLength(3)
    for (const tx of r) {
      expect(tx.side).toBe('credit')
    }
    expect(r[0]).toMatchObject({
      date: '2026-02-26',
      description: '通信料金',
      amount: '330',
    })
    expect(r[0]?.memo).toBeUndefined()
    expect(r[1]).toMatchObject({
      amount: '45000',
      memo: '分割3回 / 業務用機材',
    })
  })

  test('throws on missing required column', () => {
    const csv = '"利用日","利用金額"\n"2026/05/01","350"'
    expect(() => auPayCardParser.parse(csv)).toThrow(/CSV ヘッダー形式/)
  })
})