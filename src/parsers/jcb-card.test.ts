import { describe, expect, test } from 'vitest'
import { jcbCardParser } from './jcb-card'
import sample from './fixtures/jcb-card-sample.csv?raw'

describe('jcbCardParser', () => {
  test('metadata', () => {
    expect(jcbCardParser.name).toBe('jcb-card')
    expect(jcbCardParser.accountCode).toBe('2120')
    expect(jcbCardParser.encoding).toBe('shift_jis')
  })

  test('parses sample fixture; all rows credit', () => {
    const r = jcbCardParser.parse(sample)
    expect(r).toHaveLength(3)
    for (const tx of r) {
      expect(tx.side).toBe('credit')
    }
    expect(r[0]?.description).toBe('ETC利用')
    expect(r[1]?.amount).toBe('3300')
  })
})