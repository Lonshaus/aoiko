import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from './db';
import { seedAndReconcileAccounts } from './seed';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import type { Account } from './types';

function acc(code: string, overrides: Partial<Account> = {}): Account {
  return {
    code,
    year: 2026,
    name: `科目${code}`,
    category: 'expense',
    displayOrder: Number(code),
    ...overrides,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('seedAndReconcileAccounts', () => {
  test('空の DB には全件投入する', async () => {
    const r = await seedAndReconcileAccounts();
    expect(r.added).toBe(ACCOUNTS_2026.length);
    expect(r.updated).toBe(0);
    expect(await db.accounts.count()).toBe(ACCOUNTS_2026.length);
  });

  test('マスタに有り DB に無い科目だけ追加する', async () => {
    const master = [acc('5020', { name: '仕入' }), acc('5130', { name: '水道光熱費' })];
    await db.accounts.add(acc('5130', { name: '水道光熱費' }));
    const r = await seedAndReconcileAccounts(master);
    expect(r.added).toBe(1);
    expect((await db.accounts.get(['5020', 2026]))?.name).toBe('仕入');
    expect(await db.accounts.count()).toBe(2);
  });

  test('既存科目の isActive（利用者設定）を保持する', async () => {
    const master = [acc('5130', { name: '水道光熱費', taxCategory: 'taxable10' })];
    // 利用者が name を変えずに無効化済み
    await db.accounts.add(
      acc('5130', { name: '水道光熱費', taxCategory: 'taxable10', isActive: false }),
    );
    await seedAndReconcileAccounts(master);
    expect((await db.accounts.get(['5130', 2026]))?.isActive).toBe(false);
  });

  test('マスタ由来項目（name 等）の変更は反映しつつ isActive は保持', async () => {
    const master = [acc('5130', { name: '水道光熱費（改称）', taxCategory: 'taxable10' })];
    await db.accounts.add(
      acc('5130', { name: '水道光熱費', taxCategory: 'taxable10', isActive: false }),
    );
    const r = await seedAndReconcileAccounts(master);
    expect(r.updated).toBe(1);
    const a = await db.accounts.get(['5130', 2026]);
    expect(a?.name).toBe('水道光熱費（改称）');
    expect(a?.isActive).toBe(false);
  });

  test('マスタに無い科目は削除しない（仕訳参照の保護）', async () => {
    const master = [acc('5130')];
    await db.accounts.add(acc('9999', { name: '利用者独自科目' }));
    await seedAndReconcileAccounts(master);
    expect(await db.accounts.get(['9999', 2026])).toBeDefined();
  });

  test('冪等：2 回目は何も追加・更新しない', async () => {
    await seedAndReconcileAccounts();
    const r = await seedAndReconcileAccounts();
    expect(r.added).toBe(0);
    expect(r.updated).toBe(0);
  });

  test('別年度の同一コードは別科目として扱う', async () => {
    const master = [acc('5130', { year: 2027 })];
    await db.accounts.add(acc('5130', { year: 2026 }));
    const r = await seedAndReconcileAccounts(master);
    expect(r.added).toBe(1);
    expect(await db.accounts.count()).toBe(2);
  });
});

describe('seedAndReconcileAccounts（マスタ以外の年度）', () => {
  test('マスタの名称変更が 2026 と 2027 の両年度へ反映され、各年度の isActive は保持される', async () => {
    const master = [acc('5130', { name: '水道光熱費（改称）', taxCategory: 'taxable10' })];
    await db.accounts.bulkAdd([
      acc('5130', { name: '水道光熱費', taxCategory: 'taxable10', isActive: false }),
      acc('5130', { year: 2027, name: '水道光熱費', taxCategory: 'taxable10', isActive: true }),
    ]);
    const r = await seedAndReconcileAccounts(master);
    expect(r.updated).toBe(2);
    const a2026 = await db.accounts.get(['5130', 2026]);
    const a2027 = await db.accounts.get(['5130', 2027]);
    expect(a2026?.name).toBe('水道光熱費（改称）');
    expect(a2026?.isActive).toBe(false);
    expect(a2027?.name).toBe('水道光熱費（改称）');
    expect(a2027?.isActive).toBe(true);
  });

  test('マスタに有り他年度に無い科目は他年度にも追加される', async () => {
    const master = [acc('5020', { name: '仕入' }), acc('5130', { name: '水道光熱費' })];
    await db.accounts.add(acc('5130', { year: 2027, name: '水道光熱費' }));
    const r = await seedAndReconcileAccounts(master);
    expect(r.added).toBe(3);
    expect((await db.accounts.get(['5020', 2027]))?.year).toBe(2027);
    expect((await db.accounts.get(['5020', 2026]))?.name).toBe('仕入');
  });

  test('空の DB ではマスタの年度（2026）だけを作る', async () => {
    await seedAndReconcileAccounts();
    expect(await db.accounts.where({ year: 2026 }).count()).toBe(ACCOUNTS_2026.length);
    expect(await db.accounts.where({ year: 2027 }).count()).toBe(0);
  });
});

describe('seedAndReconcileAccounts（同時実行）', () => {
  test('空の DB で 2 回同時に呼んでも失敗せず、科目は重複しない', async () => {
    const results = await Promise.allSettled([
      seedAndReconcileAccounts(),
      seedAndReconcileAccounts(),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const added = results.reduce(
      (sum, r) => sum + (r.status === 'fulfilled' ? r.value.added : 0),
      0,
    );
    expect(added).toBe(ACCOUNTS_2026.length);
    expect(await db.accounts.count()).toBe(ACCOUNTS_2026.length);
  });

  test('マスタの名称変更と同時に切り替えた isActive は上書きされない', async () => {
    await seedAndReconcileAccounts();
    const renamed = `${ACCOUNTS_2026.find((a) => a.code === '1110')?.name ?? ''}（改称）`;
    const master = ACCOUNTS_2026.map((a) => (a.code === '1110' ? { ...a, name: renamed } : a));
    await Promise.all([
      seedAndReconcileAccounts(master),
      db.accounts.where('[code+year]').equals(['1110', 2026]).modify({ isActive: false }),
    ]);
    const row = await db.accounts.get(['1110', 2026]);
    expect(row?.name).toBe(renamed);
    expect(row?.isActive).toBe(false);
  });
});

describe('seedAndReconcileAccounts（整数でない年度の行）', () => {
  const master1110 = ACCOUNTS_2026.find((a) => a.code === '1110')!;
  // 復元で入り込みうる文字列の年度。IndexedDB では数値の 2027 とは別の鍵になる。
  const STRING_2027 = '2027' as unknown as number;

  async function stringYearRows(): Promise<Account[]> {
    return (await db.accounts.toArray()).filter((a) => (a.year as unknown) === '2027');
  }

  test('文字列の年度の行で、数値の年度の isActive を上書きしない', async () => {
    const stringRow: Account = { ...master1110, year: STRING_2027, name: '旧名', isActive: true };
    await db.accounts.bulkAdd([{ ...master1110, year: 2027, isActive: false }, stringRow]);
    await seedAndReconcileAccounts();
    expect((await db.accounts.get(['1110', 2027]))?.isActive).toBe(false);
    expect(await stringYearRows()).toEqual([stringRow]);
  });

  test('文字列の年度の行があっても、その年度へ科目を足さず、行も書き換えない', async () => {
    await seedAndReconcileAccounts();
    const stringRow: Account = { ...master1110, year: STRING_2027, name: '旧名' };
    await db.accounts.add(stringRow);
    const before = await db.accounts.count();
    await seedAndReconcileAccounts();
    expect(await db.accounts.count()).toBe(before);
    expect(await db.accounts.where('year').equals(2027).count()).toBe(0);
    expect(await stringYearRows()).toEqual([stringRow]);
  });
});
