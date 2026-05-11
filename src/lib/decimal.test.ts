import { describe, expect, test } from 'vitest'
import { D, formatJPY, fromIndexable, toIndexable } from './decimal'

describe('toIndexable', () => {
  test('zero', () => {
    expect(toIndexable(0)).toBe('00000000000000.00')
  })

  test('integer', () => {
    expect(toIndexable(12345)).toBe('00000000012345.00')
  })

  test('decimal value', () => {
    expect(toIndexable('12345.67')).toBe('00000000012345.67')
  })

  test('preserves order lexicographically', () => {
    expect(toIndexable(100) < toIndexable(1000)).toBe(true)
    expect(toIndexable(999) < toIndexable(1000)).toBe(true)
    expect(toIndexable('0.5') < toIndexable(1)).toBe(true)
  })

  test('max range 14 integer digits', () => {
    expect(toIndexable('99999999999999.99')).toBe('99999999999999.99')
  })

  test('rejects negative', () => {
    expect(() => toIndexable(-1)).toThrow(/negative/)
    expect(() => toIndexable('-0.01')).toThrow(/negative/)
  })

  test('round-trip via fromIndexable', () => {
    const values = ['0', '1', '12345', '12345.67', '0.01']
    for (const v of values) {
      const idx = toIndexable(v)
      expect(fromIndexable(idx).toString()).toBe(D(v).toString())
    }
  })
})

describe('formatJPY', () => {
  test('zero', () => {
    expect(formatJPY(0)).toBe('¥0')
  })

  test('thousands separator', () => {
    expect(formatJPY(1234567)).toBe('¥1,234,567')
  })

  test('rounds fractional to integer', () => {
    expect(formatJPY('12345.67')).toBe('¥12,346')
  })

  test('negative', () => {
    expect(formatJPY(-5000)).toBe('-¥5,000')
  })

  test('accepts Decimal instance', () => {
    expect(formatJPY(D('98765'))).toBe('¥98,765')
  })
})