import { describe, expect, test } from 'vitest'
import { saisonCardParser } from './saison-card'
import sample from './fixtures/saison-card-sample.csv?raw'

describe('saisonCardParser', () => {
  test('metadata', () => {
    expect(saisonCardParser.name).toBe('saison-card')
    expect(saisonCardParser.accountCode).toBe('2120')
    expect(saisonCardParser.encoding).toBe('shift_jis')
  })

  test('parses sample fixture', () => {
    const r = saisonCardParser.parse(sample)
    expect(r).toHaveLength(3)
    expect(r[1]?.description).toBe('紀伊國屋書店')
    expect(r[1]?.amount).toBe('2200')
  })
})