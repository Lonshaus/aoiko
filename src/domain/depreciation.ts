import { D } from '../lib/decimal';
import { newId } from '../lib/id';
import { db } from '../db/db';
import { toIndexable } from '../lib/decimal';
import type { FixedAsset, JournalEntry, JournalLine } from '../db/types';

// 減価償却の計算と仕訳生成。
// 直接法（straight-line）と 200% 定率法（declining-balance）に対応。
// 取得月から決算月まで月按分、耐用年数満了後は 1 円残し（2007年改正後の標準）。
// 200% 定率法は平成24年4月1日以後取得分の標準。改定償却率による均等償却切替も実装。

const DEPRECIATION_EXPENSE = '5210';
const ACCUMULATED_DEPRECIATION = '1520';
const RESIDUAL_VALUE = 1;

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

  if (asset.disposedDate) {
    const disposedYear = Number(asset.disposedDate.slice(0, 4));
    if (year > disposedYear) {
      return {
        amount: '0',
        accumulatedEnd: cost.minus(RESIDUAL_VALUE).toString(),
        bookValueEnd: String(RESIDUAL_VALUE),
        fullyDepreciated: true,
      };
    }
  }

  if (asset.depreciationMethod === 'straight-line') {
    return computeStraightLine(asset, year, acqYear, acqMonth, cost);
  } else if (asset.depreciationMethod === 'declining-balance') {
    return computeDecliningBalance(asset, year, acqYear, acqMonth, cost);
  }
  throw new Error(`未対応の償却方法：${asset.depreciationMethod}`);
}

function computeStraightLine(
  asset: FixedAsset,
  year: number,
  acqYear: number,
  acqMonth: number,
  cost: ReturnType<typeof D>
): DepreciationResult {
  const depreciableBase = cost.minus(RESIDUAL_VALUE);
  const fullYearAmount = depreciableBase
    .dividedBy(asset.usefulLifeYears)
    .toDecimalPlaces(0);

  let accumulated = D(0);
  for (let y = acqYear; y <= year; y++) {
    const monthsThisYear = y === acqYear ? 12 - acqMonth + 1 : 12;
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

    // 取得年は月按分
    if (y === acqYear) {
      yearAmount = yearAmount.times(12 - acqMonth + 1).dividedBy(12).toDecimalPlaces(0);
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

// 指定年度の全資産の償却仕訳をまとめて作成する。
// 既に同じ assetId + year の仕訳が存在する場合はスキップ（重複作成防止）。
export async function generateYearEndDepreciation(
  year: number
): Promise<{ created: number; skipped: number }> {
  const assets = await db.fixedAssets.toArray();
  const date = `${year}-12-31`;
  const now = Date.now();

  let created = 0;
  let skipped = 0;

  for (const asset of assets) {
    const result = computeDepreciation(asset, year);
    if (D(result.amount).isZero()) {
      continue;
    }
    const existing = await db.journalEntries
      .where('[year+date]')
      .equals([year, date])
      .filter((e) => e.description.includes(`#${asset.id.slice(0, 8)}`))
      .first();
    if (existing) {
      skipped++;
      continue;
    }

    const entryId = newId();
    await db.transaction(
      'rw',
      [db.journalEntries, db.journalLines],
      async () => {
        await db.journalEntries.add({
          id: entryId,
          date,
          year,
          description: `減価償却 ${asset.name} #${asset.id.slice(0, 8)}`,
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

  return { created, skipped };
}