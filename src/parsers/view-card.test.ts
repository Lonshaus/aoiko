import { describe, expect, test } from 'vitest'
import { viewCardParser } from './view-card'
import sample from './fixtures/view-card-sample.csv?raw'

describe('viewCardParser', () => {
  test('metadata', () => {
    expect(viewCardParser.name).toBe('view-card')
    expect(viewCardParser.accountCode).toBe('2120')
    expect(viewCardParser.encoding).toBe('shift_jis')
  })

  test('skips前言とカード会員行, parses明細', () => {
    const r = viewCardParser.parse(sample)
    expect(r).toHaveLength(3)
    expect(r[0]).toMatchObject({
      date: '2026-04-11',
      description: '駅ビル店',
      amount: '1135',
      side: 'credit',
    })
    expect(r[0]?.memo).toBeUndefined()
  })

  test('keeps非デフォルト支払区分 as memo', () => {
    const r = viewCardParser.parse(sample)
    expect(r[1]).toMatchObject({ amount: '3000', memo: '３回払' })
  })

  test('払戻額のみの行は debit（未払金 減）', () => {
    const r = viewCardParser.parse(sample)
    expect(r[2]).toMatchObject({
      date: '2026-04-20',
      amount: '500',
      side: 'debit',
    })
  })

  test('throws when no header row is found', () => {
    expect(() => viewCardParser.parse('foo,bar\n1,2')).toThrow(
      /CSV ヘッダー形式/
    )
  })
})