import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from './db';
import { ensureAccountsForYears, loadAccountsForYear, startupAccountYears } from './year-accounts';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import type { Account } from './types';

function inYear(year: number, overrides: Partial<Account> = {}): Account[] {
  return ACCOUNTS_2026.map((a) => ({ ...a, year, ...overrides }));
}
// 復元の検証が入る前に書き込めた、年度が文字列の科目。
function inStringYear(year: string, overrides: Partial<Account> = {}): Account[] {
  return inYear(0, overrides).map((a) => ({ ...a, year }) as unknown as Account);
}

function acc2027(): Account {
  return { code: '9999', year: 2027, name: '独自', category: 'expense', displayOrder: 1 };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('ensureAccountsForYears', () => {
  test('2026 年度だけのとき 2027 年度を補建し isActive を引き継ぐ', async () => {
    const base = inYear(2026);
    base[0] = { ...base[0]!, isActive: false };
    await db.accounts.bulkAdd(base);
    await ensureAccountsForYears([2027]);
    const rows = await db.accounts.where({ year: 2027 }).toArray();
    expect(rows.map((a) => a.code).sort()).toEqual(ACCOUNTS_2026.map((a) => a.code).sort());
    expect(rows.every((a) => a.year === 2027)).toBe(true);
    expect((await db.accounts.get([base[0]!.code, 2027]))?.isActive).toBe(false);
    expect(await db.accounts.where({ year: 2026 }).count()).toBe(ACCOUNTS_2026.length);
  });

  test('より新しい年度しか無いときはその最も近い年度から複製する', async () => {
    await db.accounts.bulkAdd([
      ...inYear(2027, { name: '2027バージョン' }),
      ...inYear(2030, { name: '2030バージョン' }),
    ]);
    await ensureAccountsForYears([2025]);
    const rows = await db.accounts.where({ year: 2025 }).toArray();
    expect(rows).toHaveLength(ACCOUNTS_2026.length);
    expect(rows.every((a) => a.name === '2027バージョン')).toBe(true);
  });

  test('小さい年度があるときは最も近い小さい年度から複製する', async () => {
    await db.accounts.bulkAdd([
      ...inYear(2026, { name: '2026バージョン' }),
      ...inYear(2028, { name: '2028バージョン' }),
    ]);
    await ensureAccountsForYears([2029]);
    const rows = await db.accounts.where({ year: 2029 }).toArray();
    expect(rows.every((a) => a.name === '2028バージョン')).toBe(true);
  });

  test('DB が空のときは 2026 年度のマスタから作る', async () => {
    await ensureAccountsForYears([2027]);
    expect(await db.accounts.where({ year: 2027 }).count()).toBe(ACCOUNTS_2026.length);
    expect(await db.accounts.where({ year: 2026 }).count()).toBe(0);
  });

  test('既に科目がある年度は変更しない', async () => {
    await db.accounts.bulkAdd([...inYear(2026), acc2027()]);
    await ensureAccountsForYears([2027]);
    expect(await db.accounts.where({ year: 2027 }).count()).toBe(1);
  });

  test('重複した年度や繰り返しの呼び出しで行が増えない', async () => {
    await db.accounts.bulkAdd(inYear(2026));
    await ensureAccountsForYears([2027, 2027]);
    await ensureAccountsForYears([2027]);
    expect(await db.accounts.count()).toBe(ACCOUNTS_2026.length * 2);
  });
});

describe('loadAccountsForYear', () => {
  test('科目がある年度はそのまま返す', async () => {
    await db.accounts.bulkAdd([...inYear(2026), acc2027()]);
    const rows = await loadAccountsForYear(2027);
    expect(rows).toEqual([acc2027()]);
  });

  test('科目が無い年度は近い年度の複製を year を書き換えて返し、DB へ書かない', async () => {
    await db.accounts.bulkAdd(inYear(2026));
    const before = await db.accounts.count();
    const rows = await loadAccountsForYear(2027);
    expect(rows).toHaveLength(ACCOUNTS_2026.length);
    expect(rows.every((a) => a.year === 2027)).toBe(true);
    expect(await db.accounts.count()).toBe(before);
    expect(await db.accounts.where({ year: 2027 }).count()).toBe(0);
  });

  test('小さい年度が無いときは大きい年度の最も近いものを使う', async () => {
    await db.accounts.bulkAdd([...inYear(2028, { name: 'A' }), ...inYear(2030, { name: 'B' })]);
    const rows = await loadAccountsForYear(2026);
    expect(rows.every((a) => a.name === 'A' && a.year === 2026)).toBe(true);
  });

  test('科目が 1 件も無いときは空配列', async () => {
    expect(await loadAccountsForYear(2027)).toEqual([]);
  });
});

describe('整数でない年度の科目', () => {
  test('文字列の年度は複製元にせず、数値の年度から補建する', async () => {
    await db.accounts.bulkAdd([
      ...inYear(2026, { name: '2026バージョン' }),
      ...inStringYear('2024', { name: '文字列バージョン' }),
    ]);
    await ensureAccountsForYears([2025]);
    const rows = await db.accounts.where({ year: 2025 }).toArray();
    expect(rows).toHaveLength(ACCOUNTS_2026.length);
    expect(rows.every((a) => a.name === '2026バージョン')).toBe(true);
  });

  test('文字列の年度しか無い年度も数値の年度として作り、文字列の行は変えない', async () => {
    const stringRows = inStringYear('2027', { name: '文字列バージョン' });
    await db.accounts.bulkAdd(stringRows);
    await ensureAccountsForYears([2027]);
    const rows = await db.accounts.where({ year: 2027 }).toArray();
    expect(rows).toHaveLength(ACCOUNTS_2026.length);
    expect(rows.every((a) => a.year === 2027 && a.name !== '文字列バージョン')).toBe(true);
    const kept = await db.accounts.where({ year: '2027' as unknown as number }).toArray();
    const byCode = (a: Account, b: Account) => a.code.localeCompare(b.code);
    expect(kept.sort(byCode)).toEqual(stringRows.sort(byCode));
  });

  test('整数でない年度を渡しても科目を作らず、繰り返しても例外を投げない', async () => {
    await db.accounts.bulkAdd(inYear(2026));
    await expect(ensureAccountsForYears([2026.5])).resolves.toBeUndefined();
    await expect(ensureAccountsForYears([2026.5])).resolves.toBeUndefined();
    expect(await db.accounts.where({ year: 2026.5 }).count()).toBe(0);
    expect(await db.accounts.count()).toBe(ACCOUNTS_2026.length);
  });

  test('loadAccountsForYear も文字列の年度を複製元にしない', async () => {
    await db.accounts.bulkAdd([
      ...inYear(2026, { name: '2026バージョン' }),
      ...inStringYear('2024', { name: '文字列バージョン' }),
    ]);
    const rows = await loadAccountsForYear(2025);
    expect(rows).toHaveLength(ACCOUNTS_2026.length);
    expect(rows.every((a) => a.name === '2026バージョン' && a.year === 2025)).toBe(true);
  });
});

describe('startupAccountYears', () => {
  test('処理年度を先頭に置き、重複を除く', () => {
    expect(startupAccountYears(2027, [2025, 2027, 2026, 2025])).toEqual([2027, 2025, 2026]);
  });

  test('処理年度は 2020〜2099 の整数だけ', () => {
    expect(startupAccountYears(2020, [])).toEqual([2020]);
    expect(startupAccountYears(2099, [])).toEqual([2099]);
    expect(startupAccountYears(2019, [2026])).toEqual([2026]);
    expect(startupAccountYears(2100, [2026])).toEqual([2026]);
    expect(startupAccountYears(2026.5, [2026])).toEqual([2026]);
  });

  test('処理年度が 0 や文字列なら仕訳の年度だけ', () => {
    expect(startupAccountYears(0, [2025, 2026])).toEqual([2025, 2026]);
    expect(startupAccountYears('2026', [2025, 2026])).toEqual([2025, 2026]);
  });

  test('仕訳の年度は整数なら範囲外でも通し、整数でないものは除く', () => {
    expect(startupAccountYears(undefined, [2019, '2025', 2026.5, NaN, null, 2026])).toEqual([
      2019, 2026,
    ]);
  });
});
