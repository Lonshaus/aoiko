import { describe, expect, test } from 'vitest'
import { mufgCardParser } from './mufg-card'
import sample from './fixtures/mufg-card-sample.csv?raw'

describe('mufgCardParser', () => {
  test('metadata', () => {
    expect(mufgCardParser.name).toBe('mufg-card')
    expect(mufgCardParser.displayName).toBe('三菱UFJカード')
    expect(mufgCardParser.accountCode).toBe('2120')
    expect(mufgCardParser.encoding).toBe('shift_jis')
  })

  test('カード会員行をスキップし和式日付を正規化して抽出', () => {
    const r = mufgCardParser.parse(sample)
    expect(r).toHaveLength(3)
    for (const tx of r) {
      expect(tx.side).toBe('credit')
    }
    expect(r[0]).toMatchObject({
      date: '2025-03-14',
      description: '飲食店チェーン',
      amount: '2650',
    })
    expect(r[0]?.memo).toBeUndefined()
  })

  test('複数回払いは支払回数を memo 化', () => {
    const r = mufgCardParser.parse(sample)
    expect(r[2]).toMatchObject({
      date: '2025-04-02',
      amount: '30000',
      memo: '３回払い',
    })
  })

  test('throws on missing required column', () => {
    const csv = '"確定情報","お支払日"\n"確定","2025年4月10日"'
    expect(() => mufgCardParser.parse(csv)).toThrow(/CSV ヘッダー形式/)
  })
})