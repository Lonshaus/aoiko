import { describe, expect, test } from 'vitest'
import { taxRateForCategory } from './tax-category'

describe('taxRateForCategory', () => {
  test('課税 10% / 8%', () => {
    expect(taxRateForCategory('taxable10')).toBe(0.1)
    expect(taxRateForCategory('taxable8')).toBe(0.08)
  })

  test('免税・非課税・未設定は 0', () => {
    expect(taxRateForCategory('exempt')).toBe(0)
    expect(taxRateForCategory('nontaxable')).toBe(0)
    expect(taxRateForCategory(undefined)).toBe(0)
  })
})