import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { db } from '../db/db'
import { buildPayload, collectAttachmentBlobs, PAYLOAD_VERSION } from './payload'

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
    { key: 'userRiyoshaId', value: '1234567890123456', updatedAt: now },
    { key: 'userFilerName', value: '青井 太郎', updatedAt: now },
    { key: 'userFilerAddress', value: '東京都〇〇1-2-3', updatedAt: now },
    { key: 'userZeimushoCode', value: '01101', updatedAt: now },
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

  test('既定では申告者情報（個人情報）を除外する', async () => {
    const keys = settingKeys((await buildPayload()).tables)
    expect(keys).not.toContain('userRiyoshaId')
    expect(keys).not.toContain('userFilerName')
    expect(keys).not.toContain('userFilerAddress')
    expect(keys).not.toContain('userZeimushoCode')
    // 屋号（事業情報）は除外対象ではない
    expect(keys).toContain('userBusinessName')
  })

  test('includeFilerInfo=true のときだけ申告者情報を含める', async () => {
    const rows = (await buildPayload({ includeFilerInfo: true })).tables
      .settings as SettingRow[]
    expect(rows.find((r) => r.key === 'userRiyoshaId')?.value).toBe('1234567890123456')
    expect(rows.find((r) => r.key === 'userFilerName')?.value).toBe('青井 太郎')
  })

  test('attachments のメタデータには blob（JSON 化不可）を含めない', async () => {
    await db.attachments.add({
      id: 'a1',
      entryId: 'e1',
      blob: new Blob([new Uint8Array([1])], { type: 'image/jpeg' }),
      mimeType: 'image/jpeg',
      fileName: 'x.jpg',
      createdAt: Date.now(),
    })
    const p = await buildPayload()
    const rows = p.tables.attachments as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0]).not.toHaveProperty('blob')
    expect(rows[0]!['fileName']).toBe('x.jpg')
    // JSON 化できることを確認（Blob が残っていれば JSON.stringify は落ちないが値が壊れる）
    expect(() => JSON.stringify(p)).not.toThrow()
  })
})

describe('collectAttachmentBlobs', () => {
  test('添付が無ければ空 Map', async () => {
    const m = await collectAttachmentBlobs()
    expect(m.size).toBe(0)
  })
})