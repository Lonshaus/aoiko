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

  test('先頭が日付の CSV（別形式・誤選択）は throw', () => {
    // 他行・他カードの「表頭ありで 1 行目から日付」形式を誤って選択した場合
    const wrong = '2026/04/01,スーパー,1000,1\n2026/04/02,カフェ,500,1'
    expect(() => smbcCardParser.parse(wrong)).toThrow(/CSV 形式と一致しません/)
  })

  test('列数が不足するデータ行は throw', () => {
    // カード会員行のあと、4 列しかないデータ行（位置解釈不能）
    const tooFew = '山田太郎,****-1234,一般\n2026/04/01,店,1000,1'
    expect(() => smbcCardParser.parse(tooFew)).toThrow(/列数が不足/)
  })
})