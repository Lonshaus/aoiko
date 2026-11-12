import { db } from './db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import type { Account } from './types';
import { isProcessingYear } from '../lib/initial-processing-year';

export function isIntegerYear(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}
// 小さい年度のうち最も近いもの、無ければ大きい年度のうち最も近いものを返す。
function pickSourceYear(year: number, years: number[]): number | undefined {
  const lower = years.filter((y) => y < year);
  if (lower.length > 0) {
    return Math.max(...lower);
  }
  const upper = years.filter((y) => y > year);
  return upper.length > 0 ? Math.min(...upper) : undefined;
}
// 科目が 1 件も無い年度に、近い年度の科目を isActive ごと複製する。既にある年度は触らない。
// 整数でない年度は作らず、複製元にもしない（復元で入り込んだ文字列の年度などを広げないため）。
export async function ensureAccountsForYears(years: readonly number[]): Promise<void> {
  await db.transaction('rw', db.accounts, async () => {
    const existing = await db.accounts.toArray();
    const byYear = new Map<unknown, Account[]>();
    for (const a of existing) {
      const list = byYear.get(a.year);
      if (list) {
        list.push(a);
      } else {
        byYear.set(a.year, [a]);
      }
    }
    const sourceYears = [...byYear.keys()].filter(isIntegerYear);
    const toAdd: Account[] = [];
    for (const year of new Set(years)) {
      if (!isIntegerYear(year) || byYear.has(year)) {
        continue;
      }
      const sourceYear = pickSourceYear(year, sourceYears);
      const source = sourceYear === undefined ? ACCOUNTS_2026 : (byYear.get(sourceYear) ?? []);
      toAdd.push(...source.map((a) => ({ ...a, year })));
    }
    if (toAdd.length > 0) {
      await db.accounts.bulkAdd(toAdd);
    }
  });
}
// 読み取り専用。科目が無い年度は近い年度の科目を year だけ書き換えて返す（DB へは書かない）。
export async function loadAccountsForYear(year: number): Promise<Account[]> {
  const own = await db.accounts.where({ year }).toArray();
  if (own.length > 0) {
    return own;
  }
  const years = (await db.accounts.orderBy('year').uniqueKeys()).filter(isIntegerYear);
  const sourceYear = pickSourceYear(year, years);
  if (sourceYear === undefined) {
    return [];
  }
  const source = await db.accounts.where({ year: sourceYear }).toArray();
  return source.map((a) => ({ ...a, year }));
}
// 起動時に科目を用意する年度。仕訳の日付は範囲外もあり得るので、仕訳の年度は整数なら通す。
export function startupAccountYears(
  currentYear: unknown,
  entryYears: readonly unknown[],
): number[] {
  const years = new Set<number>();
  if (isProcessingYear(currentYear)) {
    years.add(currentYear);
  }
  for (const y of entryYears) {
    if (isIntegerYear(y)) {
      years.add(y);
    }
  }
  return [...years];
}
