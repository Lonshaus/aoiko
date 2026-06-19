import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { db } from './db'
import { seedAndReconcileAccounts } from './seed'
import { ACCOUNTS_2026 } from '../tax-schema/2026'
import type { Account } from './types'

function acc(code: string, overrides: Partial<Account> = {}): Account {
  return {
    code,
    year: 2026,
    name: `科目${code}`,
    category: 'expense',
    displayOrder: Number(code),
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

describe('seedAndReconcileAccounts', () => {
  test('空の DB には全件投入する', async () => {
    const r = await seedAndReconcileAccounts()
    expect(r.added).toBe(ACCOUNTS_2026.length)
    expect(r.updated).toBe(0)
    expect(await db.accounts.count()).toBe(ACCOUNTS_2026.length)
  })

  test('マスタに有り DB に無い科目だけ追加する', async () => {
    const master = [acc('5020', { name: '仕入' }), acc('5130', { name: '水道光熱費' })]
    await db.accounts.add(acc('5130', { name: '水道光熱費' }))
    const r = await seedAndReconcileAccounts(master)
    expect(r.added).toBe(1)
    expect((await db.accounts.get(['5020', 2026]))?.name).toBe('仕入')
    expect(await db.accounts.count()).toBe(2)
  })

  test('既存科目の isActive（利用者設定）を保持する', async () => {
    const master = [acc('5130', { name: '水道光熱費', taxCategory: 'taxable10' })]
    // 利用者が name を変えずに無効化済み
    await db.accounts.add(acc('5130', { name: '水道光熱費', taxCategory: 'taxable10', isActive: false }))
    await seedAndReconcileAccounts(master)
    expect((await db.accounts.get(['5130', 2026]))?.isActive).toBe(false)
  })

  test('マスタ由来項目（name 等）の変更は反映しつつ isActive は保持', async () => {
    const master = [acc('5130', { name: '水道光熱費（改称）', taxCategory: 'taxable10' })]
    await db.accounts.add(acc('5130', { name: '水道光熱費', taxCategory: 'taxable10', isActive: false }))
    const r = await seedAndReconcileAccounts(master)
    expect(r.updated).toBe(1)
    const a = await db.accounts.get(['5130', 2026])
    expect(a?.name).toBe('水道光熱費（改称）')
    expect(a?.isActive).toBe(false)
  })

  test('マスタに無い科目は削除しない（仕訳参照の保護）', async () => {
    const master = [acc('5130')]
    await db.accounts.add(acc('9999', { name: '利用者独自科目' }))
    await seedAndReconcileAccounts(master)
    expect(await db.accounts.get(['9999', 2026])).toBeDefined()
  })

  test('冪等：2 回目は何も追加・更新しない', async () => {
    await seedAndReconcileAccounts()
    const r = await seedAndReconcileAccounts()
    expect(r.added).toBe(0)
    expect(r.updated).toBe(0)
  })

  test('別年度の同一コードは別科目として扱う', async () => {
    const master = [acc('5130', { year: 2027 })]
    await db.accounts.add(acc('5130', { year: 2026 }))
    const r = await seedAndReconcileAccounts(master)
    expect(r.added).toBe(1)
    expect(await db.accounts.count()).toBe(2)
  })
})