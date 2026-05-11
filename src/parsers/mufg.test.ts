import { describe, expect, test } from 'vitest'
import { mufgParser } from './mufg'
import sample from './fixtures/mufg-sample.csv?raw'

describe('mufgParser', () => {
  test('metadata', () => {
    expect(mufgParser.name).toBe('mufg')
    expect(mufgParser.accountCode).toBe('1130')
    expect(mufgParser.encoding).toBe('shift_jis')
  })

  test('parses sample fixture', () => {
    const r = mufgParser.parse(sample)
    expect(r).toHaveLength(3)

    expect(r[0]).toMatchObject({
      date: '2026-05-01',
      description: 'カ）クライアントエー',
      amount: '100000',
      side: 'debit',
    })
    expect(r[1]).toMatchObject({
      date: '2026-05-02',
      description: 'アマゾン.コ.ジエイピー',
      amount: '2500',
      side: 'credit',
    })
    expect(r[2]?.memo).toBe('業務')
  })

  test('falls back to 摘要 when 摘要内容 is empty', () => {
    const csv =
      '日付,摘要,摘要内容,支払い金額,預かり金額,差引残高,メモ,ラベル\n' +
      '2026/05/01,給与,,300000,,300000,,'
    const r = mufgParser.parse(csv)
    expect(r[0]?.description).toBe('給与')
  })

  test('throws on missing required column', () => {
    const csv = '日付,摘要,預かり金額\n2026/05/01,test,100'
    expect(() => mufgParser.parse(csv)).toThrow(/CSV ヘッダー形式/)
  })
})