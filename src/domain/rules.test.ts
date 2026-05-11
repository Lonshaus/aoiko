import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { db } from '../db/db'
import { newId } from '../lib/id'
import { findMatchingRule, matchRule, recordRuleHit } from './rules'
import type { ParserRule } from '../db/types'

function rule(overrides: Partial<ParserRule> = {}): ParserRule {
  return {
    id: newId(),
    matchType: 'description-includes',
    pattern: 'amazon',
    accountCode: '5200',
    priority: 10,
    hitCount: 0,
    ...overrides,
  }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

describe('matchRule', () => {
  test('description-includes matches case-insensitively', () => {
    const r = rule({ matchType: 'description-includes', pattern: 'amazon' })
    expect(matchRule(r, 'AMAZON.CO.JP')).toBe(true)
    expect(matchRule(r, 'amazon prime')).toBe(true)
    expect(matchRule(r, 'rakuten')).toBe(false)
  })

  test('vendor-name matches case-sensitively', () => {
    const r = rule({ matchType: 'vendor-name', pattern: '株式会社東京電力' })
    expect(matchRule(r, '株式会社東京電力')).toBe(true)
    expect(matchRule(r, '東京電力')).toBe(false)
  })

  test('regex matches with valid pattern', () => {
    const r = rule({ matchType: 'regex', pattern: '^AWS' })
    expect(matchRule(r, 'AWS Charge')).toBe(true)
    expect(matchRule(r, 'NotAWS')).toBe(false)
  })

  test('regex with invalid pattern returns false safely', () => {
    const r = rule({ matchType: 'regex', pattern: '[invalid(' })
    expect(matchRule(r, 'whatever')).toBe(false)
  })
})

describe('findMatchingRule', () => {
  test('returns null when no rule matches', async () => {
    await db.parserRules.add(rule({ pattern: 'amazon' }))
    const r = await findMatchingRule('rakuten')
    expect(r).toBeNull()
  })

  test('returns first matching rule by priority', async () => {
    await db.parserRules.add(rule({ pattern: 'aws', accountCode: '5200', priority: 5 }))
    await db.parserRules.add(rule({ pattern: 'aws', accountCode: '5150', priority: 100 }))
    const r = await findMatchingRule('AWS Charge')
    expect(r?.accountCode).toBe('5150')
  })

  test('case-insensitive description match', async () => {
    await db.parserRules.add(rule({ pattern: 'Amazon' }))
    const r = await findMatchingRule('amazon.co.jp')
    expect(r).not.toBeNull()
  })
})

describe('recordRuleHit', () => {
  test('increments hitCount and sets lastHitAt', async () => {
    const r = rule({ hitCount: 3 })
    await db.parserRules.add(r)
    await recordRuleHit(r.id)
    const updated = await db.parserRules.get(r.id)
    expect(updated?.hitCount).toBe(4)
    expect(updated?.lastHitAt).toBeDefined()
  })

  test('silently ignores nonexistent ID', async () => {
    await expect(recordRuleHit('does-not-exist')).resolves.toBeUndefined()
  })
})