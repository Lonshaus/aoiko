import { db } from '../db/db';
// 複数年度分の「申告済みか」をまとめて判定する。isYearLocked（1 年度用）は年度ごとに
// クエリを投げるため、CSV インポート等で行ごとに年度が分かれるバッチには非効率。
// ここでは対象年度集合を 1 回のクエリで引き、申告済み年度だけを返す。
export async function lockedYearsAmong(years: Iterable<number>): Promise<number[]> {
  const uniqueYears = [...new Set(years)];
  if (uniqueYears.length === 0) {
    return [];
  }
  const filed = await db.reportSnapshots
    .where('[year+type+status]')
    .anyOf(uniqueYears.map((y) => [y, 'pl', 'filed']))
    .toArray();
  return [...new Set(filed.map((s) => s.year))].sort((a, b) => a - b);
}
