import { describe, expect, test } from 'vitest'
import { smbcCardParser } from './smbc-card'
import sample from './fixtures/smbc-card-sample.csv?raw'

describe('smbcCardParser', () => {
  test('metadata', () => {
    expect(smbcCardParser.name).toBe('smbc-card')
    expect(smbcCardParser.accountCode).toBe('2120')
    expect(smbcCardParser.encoding).toBe('shift_jis')
  })

  test('カード会員行と請求合計行をスキップして明細を抽出', () => {
    const r = smbcCardParser.parse(sample)
    expect(r).toHaveLength(3)
    expect(r[0]).toMatchObject({
      date: '2026-04-01',
      description: 'コンビニ店',
      amount: '1110',
      side: 'credit',
    })
    expect(r[0]?.memo).toBeUndefined()
    expect(r[1]).toMatchObject({ amount: '48000', memo: '３' })
  })

  test('キャッシュバック等の負値は debit（未払金 減）', () => {
    const r = smbcCardParser.parse(sample)
    expect(r[2]).toMatchObject({
      description: 'キャッシュバック（ポイント交換）',
      amount: '732',
      side: 'debit',
    })
  })

  test('日付の無い行のみの入力は空配列', () => {
    expect(smbcCardParser.parse(',,,,,100,\n,,,,,200,')).toEqual([])
  })
})