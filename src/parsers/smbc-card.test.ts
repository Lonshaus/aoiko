import { describe, expect, test } from 'vitest'
import { smbcCardParser } from './smbc-card'
import sample from './fixtures/smbc-card-sample.csv?raw'

describe('smbcCardParser', () => {
  test('metadata', () => {
    expect(smbcCardParser.name).toBe('smbc-card')
    expect(smbcCardParser.accountCode).toBe('2120')
    expect(smbcCardParser.encoding).toBe('shift_jis')
  })

  test('parses sample fixture; all rows credit', () => {
    const r = smbcCardParser.parse(sample)
    expect(r).toHaveLength(3)
    for (const tx of r) {
      expect(tx.side).toBe('credit')
    }
    expect(r[1]?.amount).toBe('12800')
  })

  test('throws on missing required column', () => {
    const csv = '"ご利用日","利用金額"\n"2026/05/01","350"'
    expect(() => smbcCardParser.parse(csv)).toThrow(/CSV ヘッダー形式/)
  })
})