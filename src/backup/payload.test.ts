import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { db } from '../db/db'
import { buildPayload, PAYLOAD_VERSION } from './payload'

interface SettingRow {
  key: string
  value: unknown
}

function settingKeys(tables: Record<string, unknown[]>): string[] {
  return (tables.settings as SettingRow[]).map((r) => r.key)
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  const now = Date.now()
  await db.settings.bulkPut([
    { key: 'geminiApiKey', value: 'secret-gemini', updatedAt: now },
    { key: 'openaiApiKey', value: 'secret-openai', updatedAt: now },
    { key: 'userBusinessName', value: 'テスト商店', updatedAt: now },
    { key: 'backupFolderHandle', value: { not: 'serializable' }, updatedAt: now },
  ])
})

afterEach(async () => {
  await db.delete()
})

describe('buildPayload', () => {
  test('version と exportedAt を含む', async () => {
    const p = await buildPayload()
    expect(p.version).toBe(PAYLOAD_VERSION)
    expect(p.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('backupFolderHandle は常に除外（シリアライズ不可）', async () => {
    const p = await buildPayload({ includeApiKeys: true })
    expect(settingKeys(p.tables)).not.toContain('backupFolderHandle')
  })

  test('既定では API キーを除外する', async () => {
    const p = await buildPayload()
    const keys = settingKeys(p.tables)
    expect(keys).not.toContain('geminiApiKey')
    expect(keys).not.toContain('openaiApiKey')
    // 機微でない設定は残る
    expect(keys).toContain('userBusinessName')
  })

  test('includeApiKeys=false でも API キーを除外', async () => {
    const p = await buildPayload({ includeApiKeys: false })
    const keys = settingKeys(p.tables)
    expect(keys).not.toContain('geminiApiKey')
    expect(keys).not.toContain('openaiApiKey')
  })

  test('includeApiKeys=true のときだけ API キーを含める', async () => {
    const p = await buildPayload({ includeApiKeys: true })
    const rows = p.tables.settings as SettingRow[]
    const gemini = rows.find((r) => r.key === 'geminiApiKey')
    expect(gemini?.value).toBe('secret-gemini')
    expect(rows.find((r) => r.key === 'openaiApiKey')?.value).toBe('secret-openai')
  })
})