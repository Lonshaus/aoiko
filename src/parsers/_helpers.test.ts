import { describe, expect, test } from 'vitest'
import {
  applySign,
  buildRawRow,
  findHeaderRow,
  isDateLike,
  normalizeDate,
  optionalColumn,
  requireColumns,
  stripComma,
} from './_helpers'

describe('normalizeDate', () => {
  test('YYYY/MM/DD / YYYY-MM-DD / YYYY.MM.DD', () => {
    expect(normalizeDate('2026/05/01')).toBe('2026-05-01')
    expect(normalizeDate('2026-05-01')).toBe('2026-05-01')
    expect(normalizeDate('2026.05.01')).toBe('2026-05-01')
  })

  test('1 桁の月日をゼロ埋め', () => {
    expect(normalizeDate('2026/5/1')).toBe('2026-05-01')
  })

  test('和暦表記の年月日', () => {
    expect(normalizeDate('2026年5月1日')).toBe('2026-05-01')
  })

  test('末尾の時刻を切り捨てる（PayPay 等）', () => {
    expect(normalizeDate('2026/05/01 12:34:56')).toBe('2026-05-01')
  })

  test('前後の空白を許容', () => {
    expect(normalizeDate(' 2026/05/01 ')).toBe('2026-05-01')
  })

  test('3 分割できない文字列は投げる', () => {
    expect(() => normalizeDate('2026/05')).toThrow(/日付形式/)
    expect(() => normalizeDate('')).toThrow(/日付形式/)
  })

  test('非数字は投げる（偽日付を作らない）', () => {
    expect(() => normalizeDate('abc/def/ghi')).toThrow(/日付形式/)
  })

  test('2 桁年は投げる（year が NaN になるのを防ぐ）', () => {
    expect(() => normalizeDate('26/5/1')).toThrow(/日付形式/)
  })

  test('範囲外の月日は投げる', () => {
    expect(() => normalizeDate('2026/13/01')).toThrow(/範囲/)
    expect(() => normalizeDate('2026/12/45')).toThrow(/範囲/)
    expect(() => normalizeDate('2026/00/10')).toThrow(/範囲/)
  })
})

describe('stripComma', () => {
  test('千分位カンマを除去', () => {
    expect(stripComma('1,234,567')).toBe('1234567')
    expect(stripComma('100')).toBe('100')
  })
})

describe('applySign', () => {
  test('正の数はそのまま、側も変わらない', () => {
    expect(applySign('2500', 'credit')).toEqual({ amount: '2500', side: 'credit' })
    expect(applySign('2500', 'debit')).toEqual({ amount: '2500', side: 'debit' })
  })

  test('半角マイナスは絶対値 + 側反転', () => {
    expect(applySign('-2500', 'credit')).toEqual({ amount: '2500', side: 'debit' })
    expect(applySign('-2500', 'debit')).toEqual({ amount: '2500', side: 'credit' })
  })

  test('全角マイナス（−）も符号として扱う', () => {
    expect(applySign('−2500', 'credit')).toEqual({ amount: '2500', side: 'debit' })
  })

  test('▲ / △ 表記も負数として扱う', () => {
    expect(applySign('▲2500', 'credit')).toEqual({ amount: '2500', side: 'debit' })
    expect(applySign('△2500', 'credit')).toEqual({ amount: '2500', side: 'debit' })
  })

  test('符号と数値の間の空白を許容', () => {
    expect(applySign('- 2500', 'credit')).toEqual({ amount: '2500', side: 'debit' })
  })

  test('前後の空白を除去', () => {
    expect(applySign('  2500  ', 'credit')).toEqual({ amount: '2500', side: 'credit' })
  })
})

describe('buildRawRow', () => {
  test('ヘッダーと値を対応付ける', () => {
    expect(buildRawRow(['日付', '金額'], ['2026-05-01', '1000'])).toEqual({
      日付: '2026-05-01',
      金額: '1000',
    })
  })

  test('値が不足する列は空文字', () => {
    expect(buildRawRow(['a', 'b', 'c'], ['1', '2'])).toEqual({ a: '1', b: '2', c: '' })
  })
})

describe('requireColumns', () => {
  test('全列あればインデックスを返す', () => {
    expect(requireColumns(['日付', '摘要', '金額'], ['日付', '金額'], 'テスト')).toEqual({
      日付: 0,
      金額: 2,
    })
  })

  test('欠けている列があれば投げる', () => {
    expect(() => requireColumns(['日付'], ['日付', '金額'], 'テスト')).toThrow(/金額/)
  })
})

describe('optionalColumn', () => {
  test('存在すればインデックス、無ければ -1', () => {
    expect(optionalColumn(['a', 'b'], 'b')).toBe(1)
    expect(optionalColumn(['a', 'b'], 'z')).toBe(-1)
  })
})

describe('findHeaderRow', () => {
  test('必須列を全て含む最初の行を返す', () => {
    const rows = [['カード明細'], [], ['日付', '摘要', '金額'], ['2026-05-01', 'x', '1000']]
    expect(findHeaderRow(rows, ['日付', '金額'])).toBe(2)
  })

  test('見つからなければ -1', () => {
    expect(findHeaderRow([['a'], ['b']], ['日付'])).toBe(-1)
  })

  test('searchLimit を超える行は探索しない', () => {
    const rows = [['x'], ['日付', '金額']]
    expect(findHeaderRow(rows, ['日付', '金額'], 1)).toBe(-1)
  })
})

describe('isDateLike', () => {
  test('日付らしい文字列', () => {
    expect(isDateLike('2026/05/01')).toBe(true)
    expect(isDateLike('2026-5-1')).toBe(true)
    expect(isDateLike('2026年5月1日')).toBe(true)
  })

  test('日付でない文字列', () => {
    expect(isDateLike('合計')).toBe(false)
    expect(isDateLike('')).toBe(false)
    expect(isDateLike('05/01')).toBe(false)
  })
})