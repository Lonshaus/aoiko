import { describe, expect, test } from 'vitest'
import { findParser, PARSERS } from './index'

const KNOWN_NAMES = [
  'aupay-card',
  'jcb-card',
  'life-card',
  'mufg-card',
  'mufg',
  'paypay-card',
  'paypay',
  'rakuten-card',
  'saison-card',
  'sbi-shinsei',
  'smbc-card',
  'smbc',
  'view-card',
]

describe('parser auto-discovery', () => {
  test('フラット配置・フォルダ配置の両方の parser を収集する', () => {
    const names = PARSERS.map((p) => p.name)
    for (const name of KNOWN_NAMES) {
      expect(names).toContain(name)
    }
    expect(names.length).toBe(new Set(names).size)
  })

  test('フォルダ配置（src/parsers/aupay-card/aupay-card.ts）の parser も再帰的に発見される', () => {
    const parser = findParser('aupay-card')
    expect(parser).toBeDefined()
    expect(parser?.displayName).toBe('au PAY カード')
  })

  test('_ で始まるファイル・フォルダ（テンプレート）は除外される', () => {
    const names = PARSERS.map((p) => p.name)
    expect(names).not.toContain('my-bank')
  })
})