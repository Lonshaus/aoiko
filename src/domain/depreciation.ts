import { D, Decimal } from '../lib/decimal';
import { newId } from '../lib/id';
import { db } from '../db/db';
import { toIndexable } from '../lib/decimal';
import { countsTowardTotals } from './journal';
import {
  SMALL_ASSET_ANNUAL_CAP,
  isSmallAssetEligible,
} from '../tax-schema/2026/limits';
import type { FixedAsset, JournalEntry, JournalLine } from '../db/types';
// 減価償却の計算と仕訳生成。
// 直接法（straight-line）と 200% 定率法（declining-balance）に加え、
// 少額減価償却資産の特例（措法28の2、small-asset-special）に対応。
// 取得月から決算月まで月按分、耐用年数満了後は 1 円残し（2007年改正後の標準）。
// 200% 定率法は平成24年4月1日以後取得分の標準。改定償却率による均等償却切替も実装。
// 少額特例は取得年度に全額損金算入、以降の償却なし。年間 300 万円の上限あり。

const DEPRECIATION_EXPENSE = '5210';
const ACCUMULATED_DEPRECIATION = '1520';
const RESIDUAL_VALUE = 1;
// 平成19年4月1日以後取得分の定額法償却率。償却費 = 取得価額 × 償却率。
// 率は 1/耐用年数 を小数第3位未満で切り上げた値（国税庁「減価償却資産の償却率表」）。
// 例：3年→0.334、6年→0.167、7年→0.143、9年→0.112（単純な 1/N とは一致しない）。
export function straightLineRate(usefulLifeYears: number): Decimal {
  if (usefulLifeYears < 1) {
    throw new Error(`耐用年数が不正です：${usefulLifeYears}`);
  }
  return D(1).dividedBy(usefulLifeYears).toDecimalPlaces(3, Decimal.ROUND_UP);
}
// 当年の償却対象月数。取得年は取得月から、処分年は処分月まで月割する。
function activeMonths(
  y: number,
  acqYear: number,
  acqMonth: number,
  disposedYear: number | null,
  disposedMonth: number
): number {
  const start = y === acqYear ? acqMonth : 1;
  const end = disposedYear !== null && y === disposedYear ? disposedMonth : 12;
  return Math.max(0, end - start + 1);
}
// 200% 定率法の償却率・改定償却率・保証率テーブル。
// 出典：国税庁「減価償却資産の償却率等表」（平成24年4月1日以後取得分）。
const DECLINING_RATE_TABLE: Record<
  number,
  { rate: number; revisedRate: number; guarantee: number }
> = {
  2: { rate: 1.0, revisedRate: 1.0, guarantee: 0 },
  3: { rate: 0.667, revisedRate: 1.0, guarantee: 0.11089 },
  4: { rate: 0.5, revisedRate: 1.0, guarantee: 0.12499 },
  5: { rate: 0.4, revisedRate: 0.5, guarantee: 0.108 },
  6: { rate: 0.333, revisedRate: 0.334, guarantee: 0.09911 },
  7: { rate: 0.286, revisedRate: 0.334, guarantee: 0.0868 },
  8: { rate: 0.25, revisedRate: 0.334, guarantee: 0.07909 },
  9: { rate: 0.222, revisedRate: 0.25, guarantee: 0.07126 },
  10: { rate: 0.2, revisedRate: 0.25, guarantee: 0.06552 },
  11: { rate: 0.182, revisedRate: 0.2, guarantee: 0.05992 },
  12: { rate: 0.167, revisedRate: 0.2, guarantee: 0.05566 },
  13: { rate: 0.154, revisedRate: 0.167, guarantee: 0.0518 },
  14: { rate: 0.143, revisedRate: 0.167, guarantee: 0.04854 },
  15: { rate: 0.133, revisedRate: 0.143, guarantee: 0.04565 },
  16: { rate: 0.125, revisedRate: 0.143, guarantee: 0.04294 },
  17: { rate: 0.118, revisedRate: 0.125, guarantee: 0.04038 },
  18: { rate: 0.111, revisedRate: 0.112, guarantee: 0.03884 },
  19: { rate: 0.105, revisedRate: 0.112, guarantee: 0.03693 },
  20: { rate: 0.1, revisedRate: 0.112, guarantee: 0.03486 },
};

export interface DepreciationResult {
  /** その年度の償却額 */
  amount: string;
  /** その年度末時点の累計償却額 */
  accumulatedEnd: string;
  /** その年度末時点の簿価（取得価額 - 累計償却額） */
  bookValueEnd: string;
  /** 完全に償却済み（残存簿価 = 1 円） */
  fullyDepreciated: boolean;
}

export function computeDepreciation(
  asset: FixedAsset,
  year: number
): DepreciationResult {
  const cost = D(asset.acquisitionCost);
  const acqYear = Number(asset.acquisitionDate.slice(0, 4));
  const acqMonth = Number(asset.acquisitionDate.slice(5, 7));

  if (year < acqYear) {
    return {
      amount: '0',
      accumulatedEnd: '0',
      bookValueEnd: cost.toString(),
      fullyDepreciated: false,
    };
  }

  // 一括償却資産は除却後も 3 年均等償却を継続する（未償却残高の一時損金算入は不可）ため、
  // 除却による打ち切りの対象外とする。
  if (asset.disposedDate && asset.depreciationMethod !== 'lump-sum') {
    const disposedYear = Number(asset.disposedDate.slice(0, 4));
    if (year > disposedYear) {
      // 除却済み：当年の償却額は 0。簿価は除却年度末の状態をそのまま引き継ぐ
      // （少額特例なら 0、通常償却なら除却年までの償却後簿価）。
      const finalState = computeDepreciation(asset, disposedYear);
      return {
        amount: '0',
        accumulatedEnd: finalState.accumulatedEnd,
        bookValueEnd: finalState.bookValueEnd,
        fullyDepreciated: finalState.fullyDepreciated,
      };
    }
  }

  if (asset.depreciationMethod === 'straight-line') {
    return computeStraightLine(asset, year, acqYear, acqMonth, cost);
  } else if (asset.depreciationMethod === 'declining-balance') {
    return computeDecliningBalance(asset, year, acqYear, acqMonth, cost);
  } else if (asset.depreciationMethod === 'small-asset-special') {
    return computeSmallAssetSpecial(asset, year, acqYear, cost);
  } else if (asset.depreciationMethod === 'lump-sum') {
    return computeLumpSum(year, acqYear, cost);
  }
  throw new Error(`未対応の償却方法：${asset.depreciationMethod}`);
}
// 一括償却資産（施行令139条）：取得価額を 3 年で均等償却。取得月による月按分は無く、
// 除却・売却後も未償却残高の一時損金算入はできず 3 年間の償却を継続する。
// 各年の償却額 = 取得価額 × 当期の月数(常に12)/36。最終年は端数調整で残高を 0 にする。
function computeLumpSum(
  year: number,
  acqYear: number,
  cost: ReturnType<typeof D>
): DepreciationResult {
  const yearlyAmount = cost.dividedBy(3).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const finalYear = acqYear + 2;
  if (year > finalYear) {
    return {
      amount: '0',
      accumulatedEnd: cost.toString(),
      bookValueEnd: '0',
      fullyDepreciated: true,
    };
  }
  let accumulated = D(0);
  for (let y = acqYear; y <= year; y++) {
    const isFinalYear = y === finalYear;
    const yearAmount = isFinalYear ? cost.minus(accumulated) : yearlyAmount;
    accumulated = accumulated.plus(yearAmount);
    if (y === year) {
      return {
        amount: yearAmount.toString(),
        accumulatedEnd: accumulated.toString(),
        bookValueEnd: cost.minus(accumulated).toString(),
        fullyDepreciated: isFinalYear,
      };
    }
  }
  throw new Error('unreachable');
}
// 少額減価償却資産の特例（措法28の2）：取得年度に全額損金算入。
// 取得日・取得価額が適用範囲外でもこの関数は計算自体は実施する（呼出元で eligibility は検証する想定）。
// 年合計 300 万円上限は呼出元（generateYearEndDepreciation）で資産横断的にチェックする。
function computeSmallAssetSpecial(
  asset: FixedAsset,
  year: number,
  acqYear: number,
  cost: ReturnType<typeof D>
): DepreciationResult {
  if (year === acqYear) {
    return {
      amount: cost.toString(),
      accumulatedEnd: cost.toString(),
      bookValueEnd: '0',
      fullyDepreciated: true,
    };
  }
  return {
    amount: '0',
    accumulatedEnd: cost.toString(),
    bookValueEnd: '0',
    fullyDepreciated: true,
  };
}

function computeStraightLine(
  asset: FixedAsset,
  year: number,
  acqYear: number,
  acqMonth: number,
  cost: ReturnType<typeof D>
): DepreciationResult {
  // 平成19年以後の定額法：満年度額 = 取得価額 × 定額法償却率。
  // 残存簿価 1 円は償却を最終年で打ち切ることで担保する（取得価額そのものを基準にする）。
  const depreciableBase = cost.minus(RESIDUAL_VALUE);
  const fullYearAmount = cost.times(straightLineRate(asset.usefulLifeYears)).toDecimalPlaces(0);
  const disposedYear = asset.disposedDate ? Number(asset.disposedDate.slice(0, 4)) : null;
  const disposedMonth = asset.disposedDate ? Number(asset.disposedDate.slice(5, 7)) : 12;

  let accumulated = D(0);
  for (let y = acqYear; y <= year; y++) {
    const monthsThisYear = activeMonths(y, acqYear, acqMonth, disposedYear, disposedMonth);
    let yearAmount = fullYearAmount
      .times(monthsThisYear)
      .dividedBy(12)
      .toDecimalPlaces(0);

    const remaining = depreciableBase.minus(accumulated);
    if (yearAmount.greaterThan(remaining)) {
      yearAmount = remaining;
    }
    if (yearAmount.lessThan(0)) {
      yearAmount = D(0);
    }
    if (y === year) {
      const accumulatedEnd = accumulated.plus(yearAmount);
      const bookValueEnd = cost.minus(accumulatedEnd);
      return {
        amount: yearAmount.toString(),
        accumulatedEnd: accumulatedEnd.toString(),
        bookValueEnd: bookValueEnd.toString(),
        fullyDepreciated: bookValueEnd.equals(RESIDUAL_VALUE),
      };
    }
    accumulated = accumulated.plus(yearAmount);
  }

  return {
    amount: '0',
    accumulatedEnd: accumulated.toString(),
    bookValueEnd: cost.minus(accumulated).toString(),
    fullyDepreciated: false,
  };
}

function computeDecliningBalance(
  asset: FixedAsset,
  year: number,
  acqYear: number,
  acqMonth: number,
  cost: ReturnType<typeof D>
): DepreciationResult {
  const rates = DECLINING_RATE_TABLE[asset.usefulLifeYears];
  if (!rates) {
    throw new Error(
      `定率法の償却率テーブルに耐用年数 ${asset.usefulLifeYears} 年が未登録（対応：2〜20年）`
    );
  }

  const guaranteeAmount = cost.times(rates.guarantee);
  const disposedYear = asset.disposedDate ? Number(asset.disposedDate.slice(0, 4)) : null;
  const disposedMonth = asset.disposedDate ? Number(asset.disposedDate.slice(5, 7)) : 12;

  let bookValue = cost;
  let accumulated = D(0);
  let revisedBase: ReturnType<typeof D> | null = null;

  for (let y = acqYear; y <= year; y++) {
    let yearAmount: ReturnType<typeof D>;

    if (revisedBase) {
      // 改定取得価額 × 改定償却率（以後は均等償却）
      yearAmount = revisedBase.times(rates.revisedRate).toDecimalPlaces(0);
    } else {
      const standard = bookValue.times(rates.rate).toDecimalPlaces(0);
      // 保証額を下回ったら改定モードへ
      if (standard.lessThan(guaranteeAmount)) {
        revisedBase = bookValue;
        yearAmount = revisedBase.times(rates.revisedRate).toDecimalPlaces(0);
      } else {
        yearAmount = standard;
      }
    }
    // 取得年・処分年は月按分
    const monthsThisYear = activeMonths(y, acqYear, acqMonth, disposedYear, disposedMonth);
    if (monthsThisYear < 12) {
      yearAmount = yearAmount.times(monthsThisYear).dividedBy(12).toDecimalPlaces(0);
    }
    // 残存簿価 1 円を下回らないよう調整
    const remaining = cost.minus(accumulated).minus(RESIDUAL_VALUE);
    if (yearAmount.greaterThan(remaining)) {
      yearAmount = remaining;
    }
    if (yearAmount.lessThan(0)) {
      yearAmount = D(0);
    }

    if (y === year) {
      const accumulatedEnd = accumulated.plus(yearAmount);
      const bookValueEnd = cost.minus(accumulatedEnd);
      return {
        amount: yearAmount.toString(),
        accumulatedEnd: accumulatedEnd.toString(),
        bookValueEnd: bookValueEnd.toString(),
        fullyDepreciated: bookValueEnd.equals(RESIDUAL_VALUE),
      };
    }

    accumulated = accumulated.plus(yearAmount);
    bookValue = cost.minus(accumulated);
  }

  return {
    amount: '0',
    accumulatedEnd: accumulated.toString(),
    bookValueEnd: cost.minus(accumulated).toString(),
    fullyDepreciated: false,
  };
}
export interface YearEndDepreciationResult {
  /** 仕訳を新規作成した件数 */
  created: number;
  /** 既存仕訳があり重複回避でスキップした件数 */
  skipped: number;
  /** 少額特例だが年合計 300 万円 cap で適用不可となった件数（仕訳未作成） */
  smallAssetCapExceeded: number;
  /** 少額特例として設定されているが取得日・価額が要件外で適用不可の件数（仕訳未作成） */
  smallAssetIneligible: number;
}

function isSmallAssetSpecialForYear(asset: FixedAsset, year: number): boolean {
  if (asset.depreciationMethod !== 'small-asset-special') {
    return false;
  }
  return Number(asset.acquisitionDate.slice(0, 4)) === year;
}
// 指定年度の全資産の償却仕訳をまとめて作成する。
// 既に同じ assetId + year の仕訳が存在する場合はスキップ（重複作成防止）。
// 少額減価償却資産の特例：年合計 300 万円 cap を超える資産は取得日昇順で打ち切り、超過分は仕訳未作成。
//   要件外の指定（適用期限超過 / 取得価額が閾値以上）も仕訳未作成として返す。
export async function generateYearEndDepreciation(
  year: number
): Promise<YearEndDepreciationResult> {
  const assets = await db.fixedAssets.toArray();
  const date = `${year}-12-31`;
  const now = Date.now();
  // 少額特例の年合計 300 万円 cap は「取得日昇順で順次充当」が国税庁基準なので
  // 当年取得・少額特例の資産を先に取得日昇順で処理する。
  const sorted = [...assets].sort((a, b) => {
    const aSmall = isSmallAssetSpecialForYear(a, year);
    const bSmall = isSmallAssetSpecialForYear(b, year);
    if (aSmall && !bSmall) {
      return -1;
    }
    if (!aSmall && bSmall) {
      return 1;
    }
    if (aSmall && bSmall) {
      return a.acquisitionDate.localeCompare(b.acquisitionDate);
    }
    return 0;
  });

  let created = 0;
  let skipped = 0;
  let smallAssetCapExceeded = 0;
  let smallAssetIneligible = 0;
  let smallAssetUsed = D(0);

  for (const asset of sorted) {
    const isSmallThisYear = isSmallAssetSpecialForYear(asset, year);
    if (isSmallThisYear) {
      if (!isSmallAssetEligible(asset.acquisitionDate, asset.acquisitionCost)) {
        smallAssetIneligible++;
        continue;
      }
    }

    const result = computeDepreciation(asset, year);
    if (D(result.amount).isZero()) {
      continue;
    }

    if (isSmallThisYear) {
      const candidate = smallAssetUsed.plus(result.amount);
      if (candidate.greaterThan(SMALL_ASSET_ANNUAL_CAP)) {
        smallAssetCapExceeded++;
        continue;
      }
      smallAssetUsed = candidate;
    }
    // 訂正済み（reversed）や訂正仕訳は重複判定の対象外。
    // これにより誤った償却仕訳を reverseEntry で訂正したあと、正しい仕訳を再生成できる。
    // '減価償却' も条件に含めるのは、除却/売却の仕訳（asset-disposal.ts）が同じ資産タグを
    // 同一日付（除却日が年末なら 12/31 で一致し得る）に持つ場合との誤検出を避けるため。
    const existing = await db.journalEntries
      .where('[year+date]')
      .equals([year, date])
      .filter(
        (e) =>
          countsTowardTotals(e) &&
          e.description.includes(`#${asset.id.slice(0, 8)}`) &&
          e.description.includes('減価償却')
      )
      .first();
    if (existing) {
      skipped++;
      continue;
    }

    const entryId = newId();
    const description = isSmallThisYear
      ? `減価償却（措法28の2）${asset.name} #${asset.id.slice(0, 8)}`
      : `減価償却 ${asset.name} #${asset.id.slice(0, 8)}`;
    await db.transaction(
      'rw',
      [db.journalEntries, db.journalLines],
      async () => {
        await db.journalEntries.add({
          id: entryId,
          date,
          year,
          description,
          status: 'confirmed',
          source: 'manual',
          createdAt: now,
          confirmedAt: now,
        } satisfies JournalEntry);

        const lines: JournalLine[] = [
          {
            id: newId(),
            entryId,
            side: 'debit',
            accountCode: DEPRECIATION_EXPENSE,
            amount: result.amount,
            amountIndexed: toIndexable(result.amount),
            taxRate: 0,
            taxIncluded: true,
            invoiceCompliant: false,
          },
          {
            id: newId(),
            entryId,
            side: 'credit',
            accountCode: ACCUMULATED_DEPRECIATION,
            amount: result.amount,
            amountIndexed: toIndexable(result.amount),
            taxRate: 0,
            taxIncluded: true,
            invoiceCompliant: false,
          },
        ];
        await db.journalLines.bulkAdd(lines);
      }
    );
    created++;
  }

  return { created, skipped, smallAssetCapExceeded, smallAssetIneligible };
}