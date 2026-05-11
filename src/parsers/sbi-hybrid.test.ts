import { describe, expect, test } from 'vitest'
import { sbiHybridParser } from './sbi-hybrid'
import sampleCsv from './fixtures/sbi-hybrid-sample.csv?raw'

describe('sbiHybridParser', () => {
  test('parser metadata', () => {
    expect(sbiHybridParser.name).toBe('sbi-hybrid')
    expect(sbiHybridParser.accountCode).toBe('1130')
  })

  test('sample fixture parses to expected transactions', () => {
    const result = sbiHybridParser.parse(sampleCsv)
    expect(result).toHaveLength(5)

    expect(result[0]).toMatchObject({
      date: '2026-05-01',
      description: 'フリコミ アオイ ジムシヨ',
      amount: '100000',
      side: 'debit',
      balance: '250000',
    })

    expect(result[1]).toMatchObject({
      date: '2026-05-02',
      description: 'アマゾン.コ.ジエイピー',
      amount: '2500',
      side: 'credit',
      balance: '247500',
    })

    expect(result[2]).toMatchObject({
      date: '2026-05-03',
      description: 'ＡＷＳ サーバー',
      amount: '8800',
      side: 'credit',
      memo: '業務',
    })
  })

  test('empty memo not included in result', () => {
    const result = sbiHybridParser.parse(sampleCsv)
    expect(result[0]?.memo).toBeUndefined()
  })

  test('handles BOM-prefixed input', () => {
    const withBom = '﻿' + sampleCsv
    const result = sbiHybridParser.parse(withBom)
    expect(result).toHaveLength(5)
  })

  test('handles CRLF line endings', () => {
    const withCrlf = sampleCsv.replace(/\n/g, '\r\n')
    const result = sbiHybridParser.parse(withCrlf)
    expect(result).toHaveLength(5)
  })

  test('strips thousand-separator commas from amounts', () => {
    const csv =
      '"日付","内容","出金金額(円)","入金金額(円)","残高(円)","メモ"\n' +
      '"2026/05/01","テスト","","1,234,567","2,000,000",""'
    const result = sbiHybridParser.parse(csv)
    expect(result[0]?.amount).toBe('1234567')
    expect(result[0]?.balance).toBe('2000000')
  })

  test('skips rows with both columns empty', () => {
    const csv =
      '"日付","内容","出金金額(円)","入金金額(円)","残高(円)","メモ"\n' +
      '"2026/05/01","空行テスト","","","250,000",""\n' +
      '"2026/05/02","正常","","100","250,100",""'
    const result = sbiHybridParser.parse(csv)
    expect(result).toHaveLength(1)
    expect(result[0]?.description).toBe('正常')
  })

  test('throws on unrecognized header', () => {
    const csv = '"DATE","DESC","OUT","IN"\n"2026/05/01","x","100",""'
    expect(() => sbiHybridParser.parse(csv)).toThrow(
      /CSV ヘッダー形式と一致しません/
    )
  })

  test('returns empty for header-only CSV', () => {
    const csv = '"日付","内容","出金金額(円)","入金金額(円)","残高(円)","メモ"'
    expect(sbiHybridParser.parse(csv)).toEqual([])
  })

  test('rawRow contains original header-keyed values', () => {
    const result = sbiHybridParser.parse(sampleCsv)
    expect(result[0]?.rawRow['日付']).toBe('2026/05/01')
    expect(result[0]?.rawRow['内容']).toBe('フリコミ アオイ ジムシヨ')
  })
})