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
// 申告済み年度への書き込みを止められたときに投げる。年度を持たせるのは、
// 呼出側が「どの年度で止まったか」を利用者へ出せるようにするため。
export class FiledYearError extends Error {
  readonly years: number[];
  constructor(years: number[]) {
    super(
      `${years.join('・')} 年は申告済みのためロックされています。修正する場合は年度ロックを解除してください。`,
    );
    this.name = 'FiledYearError';
    this.years = years;
  }
}
/**
 * 申告済み年度への書き込みを止める。書き込む処理の入口で、トランザクションを
 * 開く前に呼ぶ（reportSnapshots を読むため、書込トランザクションの中からは引けない）。
 *
 * 画面側の確認ダイアログを通ったときだけ allowFiledYear で開ける。画面の確認は
 * 案内であって防壁ではない。画面を経ない経路（復元後の再実行、将来増える入口）から
 * 申告済みの年度が書き換わると、電子帳簿保存法上まずいうえに気付く手段が無い。
 */
export async function assertYearsWritable(
  years: Iterable<number>,
  options?: { allowFiledYear?: boolean },
): Promise<void> {
  if (options?.allowFiledYear === true) {
    return;
  }
  const locked = await lockedYearsAmong(years);
  if (locked.length > 0) {
    throw new FiledYearError(locked);
  }
}
