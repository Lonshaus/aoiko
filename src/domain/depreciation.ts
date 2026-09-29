import { D, Decimal } from '../lib/decimal';
import { newId } from '../lib/id';
import { db } from '../db/db';
import { toIndexable } from '../lib/decimal';
import { countsTowardTotals } from './journal';
import { assertYearsWritable, markConfirmedWrite } from './year-lock';
import {
  isImmediateExpenseRequired,
  isSmallAssetEligible,
  smallAssetAnnualCap,
} from '../tax-schema/2026/limits';
import { oldStraightLineRate } from './business-opening';
import type { FixedAsset, JournalEntry, JournalLine } from '../db/types';
import { m } from '../paraglide/messages';
// 減価償却の計算と仕訳生成。
// 定額法（straight-line）と 200% 定率法（declining-balance）に加え、
// 少額減価償却資産の特例（措法28の2、small-asset-special）に対応。
// 取得月から決算月まで月按分、償却可能限度額は所令134条（既定は 1 円残し、無形固定資産・坑道は全額）。
// 200% 定率法は平成24年4月1日以後取得分の標準。改定償却率による均等償却切替も実装。
// 少額特例は取得年度に全額損金算入、以降の償却なし。年間 300 万円の上限あり。

const DEPRECIATION_EXPENSE = '5210';
const ACCUMULATED_DEPRECIATION = '1520';
const RESIDUAL_VALUE = 1;
// 所令134条1項2号ハの対象となる所有権移転外リース契約の締結期限。
const LEASE_RESIDUAL_GUARANTEE_DEADLINE = '2027-03-31';
// 所令134条2項（旧償却方法の5年均等償却）は平成20年分以後に適用される。
const OLD_METHOD_FIVE_YEAR_START = 2008;
const OLD_METHOD_FIVE_YEAR_DIVISOR = 5;
// 所令134条1項1号イの償却可能限度額（取得価額の 95%）。
const OLD_METHOD_LIMIT_RATE = '0.95';
// 耐用年数省令別表第十一：別表第一・第二・第五・第六（ソフトウエア除く）の残存割合。
const OLD_TANGIBLE_RESIDUAL_RATE = '0.1';
// 平成19年4月1日以後取得分の定額法償却率。償却費 = 取得価額 × 償却率。
// 率は 1/耐用年数 を小数第3位未満で切り上げた値（国税庁「減価償却資産の償却率表」）。
// 例：3年→0.334、6年→0.167、7年→0.143、9年→0.112（単純な 1/N とは一致しない）。
export function straightLineRate(usefulLifeYears: number): Decimal {
  if (usefulLifeYears < 1) {
    throw new Error(m.error_useful_life_invalid({ years: usefulLifeYears }));
  }
  return D(1).dividedBy(usefulLifeYears).toDecimalPlaces(3, Decimal.ROUND_UP);
}
// 当年の償却対象月数。取得年は取得月から、処分年は処分月まで月割する。
function activeMonths(
  y: number,
  acqYear: number,
  acqMonth: number,
  disposedYear: number | null,
  disposedMonth: number,
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
// 旧定率法の償却率。出典：耐用年数省令別表第七（平成19年3月31日以前取得分）。
// 2〜100年、条文の表を1件ずつ書き写した値（式による算出ではない。qa/tax-sources/49_taiyonensu_shourei_beppyo7_8.md
// 「参考：算用数字への機械変換」列3と一致することを depreciation.test.ts で1件ずつ検証する）。
const OLD_DECLINING_RATE_TABLE: Record<number, string> = {
  2: '0.684',
  3: '0.536',
  4: '0.438',
  5: '0.369',
  6: '0.319',
  7: '0.280',
  8: '0.250',
  9: '0.226',
  10: '0.206',
  11: '0.189',
  12: '0.175',
  13: '0.162',
  14: '0.152',
  15: '0.142',
  16: '0.134',
  17: '0.127',
  18: '0.120',
  19: '0.114',
  20: '0.109',
  21: '0.104',
  22: '0.099',
  23: '0.095',
  24: '0.092',
  25: '0.088',
  26: '0.085',
  27: '0.082',
  28: '0.079',
  29: '0.076',
  30: '0.074',
  31: '0.072',
  32: '0.069',
  33: '0.067',
  34: '0.066',
  35: '0.064',
  36: '0.062',
  37: '0.060',
  38: '0.059',
  39: '0.057',
  40: '0.056',
  41: '0.055',
  42: '0.053',
  43: '0.052',
  44: '0.051',
  45: '0.050',
  46: '0.049',
  47: '0.048',
  48: '0.047',
  49: '0.046',
  50: '0.045',
  51: '0.044',
  52: '0.043',
  53: '0.043',
  54: '0.042',
  55: '0.041',
  56: '0.040',
  57: '0.040',
  58: '0.039',
  59: '0.038',
  60: '0.038',
  61: '0.037',
  62: '0.036',
  63: '0.036',
  64: '0.035',
  65: '0.035',
  66: '0.034',
  67: '0.034',
  68: '0.033',
  69: '0.033',
  70: '0.032',
  71: '0.032',
  72: '0.032',
  73: '0.031',
  74: '0.031',
  75: '0.030',
  76: '0.030',
  77: '0.030',
  78: '0.029',
  79: '0.029',
  80: '0.028',
  81: '0.028',
  82: '0.028',
  83: '0.027',
  84: '0.027',
  85: '0.026',
  86: '0.026',
  87: '0.026',
  88: '0.026',
  89: '0.026',
  90: '0.025',
  91: '0.025',
  92: '0.025',
  93: '0.025',
  94: '0.024',
  95: '0.024',
  96: '0.024',
  97: '0.023',
  98: '0.023',
  99: '0.023',
  100: '0.023',
};
// テスト用：耐用年数省令別表第七の旧定率法償却率を1件取得する（未登録は undefined）。
export function oldDecliningBalanceRate(usefulLifeYears: number): string | undefined {
  return OLD_DECLINING_RATE_TABLE[usefulLifeYears];
}

export interface DepreciationResult {
  /** その年度の償却額 */
  amount: string;
  /** その年度末時点の累計償却額 */
  accumulatedEnd: string;
  /** その年度末時点の簿価（取得価額 - 累計償却額） */
  bookValueEnd: string;
  /** 完全に償却済み（償却可能限度額に到達） */
  fullyDepreciated: boolean;
  /**
   * 償却の基礎になる金額（青色申告決算書・収支内訳書の減価償却費の計算欄）。
   * 定額法は常に取得価額。定率法は①取得年は取得価額②翌年以降は前年末未償却残高
   * ③改定償却率切替後は改定取得価額（切替年の期首未償却残高）で固定。
   */
  depreciationBase: string;
}
// 一括償却資産のグループ内での位置。precedingCost は並び順で自分より前の資産の取得価額合計。
export interface LumpSumPoolShare {
  totalCost: string;
  precedingCost: string;
}
// 償却計算の基礎とする金額（転用日価額）。転用資産は業務供用日時点の未償却残高（所令135条）。
// 定額法の年額・定率法の保証額など「取得価額」を基準とする計算は acquisitionCost（原始取得価額）を
// 直接使う。depreciableCost は累計償却額の上限（帳簿上の残高の起点）にのみ使う。
export function depreciableCost(asset: FixedAsset): string {
  return asset.conversionBasis ?? asset.acquisitionCost;
}
// 業務の用に供した日。転用資産以外は取得日と同じ。
export function serviceStartDate(asset: FixedAsset): string {
  return asset.serviceStartDate ?? asset.acquisitionDate;
}
// 所令138条1項で業務供用年に全額必要経費算入となる資産。既存の少額特例指定で 10 万円未満の資産もここへ移す。
// 適用の閾値（所令135条により転用資産も含め）は原始取得価額（所令126条の取得価額）で判定する。
export function isImmediateExpenseAsset(asset: FixedAsset): boolean {
  if (asset.usableLifeUnderOneYear === true) {
    return true;
  }
  return (
    asset.depreciationMethod === 'small-asset-special' &&
    isImmediateExpenseRequired(asset.acquisitionCost, {
      isLeasedOut: asset.isLeasedOut,
      acquisitionDate: asset.acquisitionDate,
    })
  );
}
// 少額特例（措法28の2）の資産1件の年度ごとの適用状況。
export type SmallAssetStatus = 'applicable' | 'ineligible' | 'cap-exceeded';
// 業務供用年に少額特例（措法28の2）の対象になり得る資産（所令138条の即時費用化に回るものは除く）か。
function isSmallAssetSpecialCandidate(asset: FixedAsset, year: number): boolean {
  if (asset.depreciationMethod !== 'small-asset-special' || isImmediateExpenseAsset(asset)) {
    return false;
  }
  return Number(serviceStartDate(asset).slice(0, 4)) === year;
}
// 全資産・全年度分の少額特例の適用状況をまとめて判定する。年ごとに取得日昇順で年合計 300 万円
// （開業・廃業年は月割）の cap を充当し、要件外（isSmallAssetEligible=false）または cap 超過は
// 'ineligible' / 'cap-exceeded' として返す。落選判定の取得価額の閾値は原始取得価額（所令126条）を使う。
// 結果は資産 id 単位で年度に関わらず一意（業務供用年に一度だけ判定される）。
export function smallAssetSpecialStatuses(
  assets: readonly FixedAsset[],
  businessStartDate?: string,
  businessCloseDate?: string,
): Map<string, SmallAssetStatus> {
  const byYear = new Map<number, FixedAsset[]>();
  for (const a of assets) {
    if (a.depreciationMethod !== 'small-asset-special' || isImmediateExpenseAsset(a)) {
      continue;
    }
    const year = Number(serviceStartDate(a).slice(0, 4));
    const list = byYear.get(year) ?? [];
    list.push(a);
    byYear.set(year, list);
  }
  const result = new Map<string, SmallAssetStatus>();
  for (const [year, yearAssets] of byYear) {
    const cap = smallAssetAnnualCap(year, businessStartDate, businessCloseDate);
    const sorted = [...yearAssets].sort(
      (a, b) => a.acquisitionDate.localeCompare(b.acquisitionDate) || a.id.localeCompare(b.id),
    );
    let used = D(0);
    for (const a of sorted) {
      const eligible = isSmallAssetEligible(a.acquisitionDate, a.acquisitionCost, {
        employeeCount: a.employeeCountAtAcquisition,
        isLeasedOut: a.isLeasedOut,
      });
      if (!eligible) {
        result.set(a.id, 'ineligible');
        continue;
      }
      // 措法28の2の年度上限累計は原始取得価額（所令126条）で計る（条文「取得価額の合計額」、所令135条）。
      // 実際の費用化額（転用資産は転用日価額が上限）とは別枠。
      const candidate = used.plus(a.acquisitionCost);
      if (candidate.greaterThan(cap)) {
        result.set(a.id, 'cap-exceeded');
        continue;
      }
      used = candidate;
      result.set(a.id, 'applicable');
    }
  }
  return result;
}

function isOldMethod(asset: FixedAsset): boolean {
  return (
    asset.depreciationMethod === 'old-straight-line' ||
    asset.depreciationMethod === 'old-declining-balance'
  );
}

function isFullAmountCategory(asset: FixedAsset): boolean {
  return asset.isMineShaft === true || asset.assetCategory === 8;
}
// 旧償却方法の残存価額（耐用年数省令6条・別表第十一）。生物は細目ごとの割合を渡す。
export function oldMethodResidualValue(
  cost: Decimal,
  asset: Pick<FixedAsset, 'assetCategory' | 'isMineShaft'>,
  biological?: { rate: string; cattleOrHorse: boolean },
): Decimal {
  if (asset.isMineShaft === true || asset.assetCategory === 8) {
    return D(0);
  }
  if (asset.assetCategory === 9) {
    if (!biological) {
      throw new Error('生物の旧償却方法は細目ごとの残存割合が必要です（耐用年数省令別表第十一）');
    }
    const residual = cost.times(biological.rate).toDecimalPlaces(0, Decimal.ROUND_DOWN);
    return biological.cattleOrHorse ? Decimal.min(residual, 100_000) : residual;
  }
  return cost.times(OLD_TANGIBLE_RESIDUAL_RATE).toDecimalPlaces(0, Decimal.ROUND_DOWN);
}
// 償却可能限度額（所令134条1項）。旧償却方法は1号、それ以外は2号の区分による。
export function depreciationLimit(asset: FixedAsset, cost: Decimal): Decimal {
  if (isOldMethod(asset)) {
    if (isFullAmountCategory(asset)) {
      return cost;
    }
    if (asset.assetCategory === 9) {
      return cost.minus(oldMethodResidualValue(cost, asset));
    }
    return cost.times(OLD_METHOD_LIMIT_RATE).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  }
  if (
    asset.leaseContractDate !== undefined &&
    asset.residualGuaranteeAmount !== undefined &&
    asset.leaseContractDate <= LEASE_RESIDUAL_GUARANTEE_DEADLINE
  ) {
    return cost.minus(asset.residualGuaranteeAmount);
  }
  if (isFullAmountCategory(asset)) {
    return cost;
  }
  return cost.minus(RESIDUAL_VALUE);
}

export function computeDepreciation(
  asset: FixedAsset,
  year: number,
  lumpSumPool?: LumpSumPoolShare,
  smallAssetStatuses?: ReadonlyMap<string, SmallAssetStatus>,
): DepreciationResult {
  const cost = D(depreciableCost(asset));
  const start = serviceStartDate(asset);
  const acqYear = Number(start.slice(0, 4));
  const acqMonth = Number(start.slice(5, 7));

  if (year < acqYear) {
    return {
      amount: '0',
      accumulatedEnd: '0',
      bookValueEnd: cost.toString(),
      fullyDepreciated: false,
      depreciationBase: cost.toString(),
    };
  }
  // 一括償却資産は除却後も 3 年均等償却を継続する（未償却残高の一時損金算入は不可）ため、
  // 除却による打ち切りの対象外とする。
  if (asset.disposedDate && asset.depreciationMethod !== 'lump-sum') {
    const disposedYear = Number(asset.disposedDate.slice(0, 4));
    if (year > disposedYear) {
      // 除却済み：当年の償却額は 0。簿価は除却年度末の状態をそのまま引き継ぐ
      // （少額特例なら 0、通常償却なら除却年までの償却後簿価）。
      const finalState = computeDepreciation(asset, disposedYear, lumpSumPool, smallAssetStatuses);
      return {
        amount: '0',
        accumulatedEnd: finalState.accumulatedEnd,
        bookValueEnd: finalState.bookValueEnd,
        fullyDepreciated: finalState.fullyDepreciated,
        depreciationBase: finalState.depreciationBase,
      };
    }
  }
  if (asset.usableLifeUnderOneYear === true) {
    return computeSmallAssetSpecial(year, acqYear, cost);
  }

  switch (asset.depreciationMethod) {
    case 'straight-line':
      return computeStraightLine(asset, year, acqYear, acqMonth, cost);
    case 'declining-balance':
      return computeDecliningBalance(asset, year, acqYear, acqMonth, cost);
    case 'small-asset-special': {
      if (isImmediateExpenseAsset(asset)) {
        return computeSmallAssetSpecial(year, acqYear, cost);
      }
      // 落選（要件外・cap 超過）は所令125条2号イにより定額法／定率法へ切替。未判定（statuses 未指定）
      // は既存データ互換のため常に適用扱い（従来どおり全額を業務供用年に費用化）。
      const status = smallAssetStatuses?.get(asset.id);
      if (status === 'ineligible' || status === 'cap-exceeded') {
        return asset.decliningBalanceElected === true
          ? computeDecliningBalance(asset, year, acqYear, acqMonth, cost)
          : computeStraightLine(asset, year, acqYear, acqMonth, cost);
      }
      return computeSmallAssetSpecial(year, acqYear, cost);
    }
    case 'lump-sum':
      return computeLumpSum(year, acqYear, D(asset.acquisitionCost), cost, lumpSumPool);
    case 'old-straight-line':
    case 'old-declining-balance':
      return computeOldMethod(asset, year, acqYear, acqMonth, cost);
    case 'lease-period-straight-line':
      return computeLeasePeriodStraightLine(asset, year, acqYear, acqMonth);
  }
  throw new Error(m.error_depreciation_method_unsupported({ method: asset.depreciationMethod }));
}
// 同じ lumpSumPoolId・同じ業務供用年の一括償却資産をグループにまとめる。未指定の資産は含めない。
export function lumpSumPoolShares(assets: readonly FixedAsset[]): Map<string, LumpSumPoolShare> {
  const groups = new Map<string, FixedAsset[]>();
  for (const a of assets) {
    if (
      a.depreciationMethod !== 'lump-sum' ||
      a.lumpSumPoolId === undefined ||
      a.usableLifeUnderOneYear === true
    ) {
      continue;
    }
    const key = `${a.lumpSumPoolId}\u0000${serviceStartDate(a).slice(0, 4)}`;
    const list = groups.get(key) ?? [];
    list.push(a);
    groups.set(key, list);
  }
  const shares = new Map<string, LumpSumPoolShare>();
  for (const members of groups.values()) {
    members.sort(
      (x, y) => x.acquisitionDate.localeCompare(y.acquisitionDate) || x.id.localeCompare(y.id),
    );
    // 一括償却群合計は所令135条により原始取得価額（所令126条）で計る。
    const total = members.reduce((sum, a) => sum.plus(a.acquisitionCost), D(0));
    let preceding = D(0);
    for (const a of members) {
      shares.set(a.id, { totalCost: total.toString(), precedingCost: preceding.toString() });
      preceding = preceding.plus(a.acquisitionCost);
    }
  }
  return shares;
}
// 一括償却資産（施行令139条）：原始取得価額を 3 年で均等償却。取得月による月按分は無く、
// 除却・売却後も未償却残高の一時損金算入はできず 3 年間の償却を継続する。
// 転用資産（所令135条）は、原始取得価額の 3 分の 1 を毎年計上しつつ、累計は転用日価額（conversionCost）で止める。
function computeLumpSum(
  year: number,
  acqYear: number,
  originalCost: Decimal,
  conversionCost: Decimal,
  pool?: LumpSumPoolShare,
): DepreciationResult {
  const finalYear = acqYear + 2;
  if (year > finalYear) {
    return {
      amount: '0',
      accumulatedEnd: conversionCost.toString(),
      bookValueEnd: '0',
      fullyDepreciated: true,
      depreciationBase: originalCost.toString(),
    };
  }
  const raw = lumpSumAccumulated(year - acqYear + 1, originalCost, pool);
  const previousRaw =
    year === acqYear ? D(0) : lumpSumAccumulated(year - acqYear, originalCost, pool);
  const accumulated = Decimal.min(raw, conversionCost);
  const previous = Decimal.min(previousRaw, conversionCost);
  return {
    amount: accumulated.minus(previous).toString(),
    accumulatedEnd: accumulated.toString(),
    bookValueEnd: conversionCost.minus(accumulated).toString(),
    fullyDepreciated: year === finalYear || accumulated.equals(conversionCost),
    depreciationBase: originalCost.toString(),
  };
}
// k 年目末の累計額。グループ指定時は一括償却対象額の ÷3 を累計の差で按分し、各年のグループ合計を端数なく一致させる。
function lumpSumAccumulated(k: number, cost: Decimal, pool?: LumpSumPoolShare): Decimal {
  if (!pool) {
    return k >= 3 ? cost : cost.dividedBy(3).toDecimalPlaces(0, Decimal.ROUND_DOWN).times(k);
  }
  const total = D(pool.totalCost);
  if (total.isZero()) {
    return D(0);
  }
  const poolAccumulated =
    k >= 3 ? total : total.dividedBy(3).toDecimalPlaces(0, Decimal.ROUND_DOWN).times(k);
  const preceding = D(pool.precedingCost);
  const upTo = (share: Decimal): Decimal =>
    poolAccumulated.times(share).dividedBy(total).toDecimalPlaces(0);
  return upTo(preceding.plus(cost)).minus(upTo(preceding));
}
// 少額特例の要件と年合計 300 万円上限は呼出元（generateYearEndDepreciation）で資産横断的に判定する。
function computeSmallAssetSpecial(
  year: number,
  acqYear: number,
  cost: Decimal,
): DepreciationResult {
  return {
    amount: year === acqYear ? cost.toString() : '0',
    accumulatedEnd: cost.toString(),
    bookValueEnd: '0',
    fullyDepreciated: true,
    depreciationBase: cost.toString(),
  };
}

function computeStraightLine(
  asset: FixedAsset,
  year: number,
  acqYear: number,
  acqMonth: number,
  cost: Decimal,
): DepreciationResult {
  // 平成19年以後の定額法：満年度額 = 原始取得価額 × 定額法償却率（所令135条：転用資産も原始取得価額基準）。
  // 累計償却額の上限は転用日価額（cost）で打ち切る（帳簿上の残高はそこが起点のため）。
  const originalCost = D(asset.acquisitionCost);
  const depreciableBase = depreciationLimit(asset, cost);
  const floor = cost.minus(depreciableBase);
  const fullYearAmount = originalCost
    .times(straightLineRate(asset.usefulLifeYears))
    .toDecimalPlaces(0);
  const disposedYear = asset.disposedDate ? Number(asset.disposedDate.slice(0, 4)) : null;
  const disposedMonth = asset.disposedDate ? Number(asset.disposedDate.slice(5, 7)) : 12;

  let accumulated = D(0);
  for (let y = acqYear; y <= year; y++) {
    const monthsThisYear = activeMonths(y, acqYear, acqMonth, disposedYear, disposedMonth);
    let yearAmount = fullYearAmount.times(monthsThisYear).dividedBy(12).toDecimalPlaces(0);

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
        fullyDepreciated: bookValueEnd.equals(floor),
        depreciationBase: originalCost.toString(),
      };
    }
    accumulated = accumulated.plus(yearAmount);
  }

  return {
    amount: '0',
    accumulatedEnd: accumulated.toString(),
    bookValueEnd: cost.minus(accumulated).toString(),
    fullyDepreciated: false,
    depreciationBase: originalCost.toString(),
  };
}

function computeDecliningBalance(
  asset: FixedAsset,
  year: number,
  acqYear: number,
  acqMonth: number,
  cost: Decimal,
): DepreciationResult {
  const rates = DECLINING_RATE_TABLE[asset.usefulLifeYears];
  if (!rates) {
    throw new Error(
      `定率法の償却率テーブルに耐用年数 ${asset.usefulLifeYears} 年が未登録（対応：2〜20年）`,
    );
  }

  const limit = depreciationLimit(asset, cost);
  const floor = cost.minus(limit);
  // 償却保証額（所令120条の2第2項1号）は原始取得価額基準（所令135条：転用資産も原始取得価額）。
  const guaranteeAmount = D(asset.acquisitionCost).times(rates.guarantee);
  const disposedYear = asset.disposedDate ? Number(asset.disposedDate.slice(0, 4)) : null;
  const disposedMonth = asset.disposedDate ? Number(asset.disposedDate.slice(5, 7)) : 12;

  let bookValue = cost;
  let accumulated = D(0);
  let revisedBase: Decimal | null = null;

  for (let y = acqYear; y <= year; y++) {
    let yearAmount: Decimal;

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
    // 償却の基礎になる金額：取得年は取得価額（bookValue = cost の初期値）、
    // 翌年以降は前年末未償却残高（bookValue）、改定モード切替後は改定取得価額（revisedBase）で固定。
    const depreciationBase = revisedBase ?? bookValue;
    // 取得年・処分年は月按分
    const monthsThisYear = activeMonths(y, acqYear, acqMonth, disposedYear, disposedMonth);
    if (monthsThisYear < 12) {
      yearAmount = yearAmount.times(monthsThisYear).dividedBy(12).toDecimalPlaces(0);
    }
    // 償却可能限度額（既定は残存簿価 1 円）を下回らないよう調整
    const remaining = limit.minus(accumulated);
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
        fullyDepreciated: bookValueEnd.equals(floor),
        depreciationBase: depreciationBase.toString(),
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
    depreciationBase: (revisedBase ?? bookValue).toString(),
  };
}
// 旧定額法・旧定率法。1号イ・ハは限度額到達の翌年以後、残額 −1 円を 5 年で均等償却する（所令134条2項）。
function computeOldMethod(
  asset: FixedAsset,
  year: number,
  acqYear: number,
  acqMonth: number,
  cost: Decimal,
): DepreciationResult {
  const isDeclining = asset.depreciationMethod === 'old-declining-balance';
  const decliningRate = OLD_DECLINING_RATE_TABLE[asset.usefulLifeYears];
  if (isDeclining && decliningRate === undefined) {
    throw new Error(`旧定率法の償却率テーブルに耐用年数 ${asset.usefulLifeYears} 年が未登録`);
  }
  // 限度額・5年均等の基礎は原始取得価額基準（所令135条）。転用前に償却済みとみなされる差額
  // （preConversionDeemed）を accumulated の見做し起点に加え、95%到達判定を原始取得価額基準に揃える。
  const originalCost = D(asset.acquisitionCost);
  const preConversionDeemed = originalCost.minus(cost);
  const limit = depreciationLimit(asset, originalCost);
  const hasFiveYear = !isFullAmountCategory(asset);
  const finalLimit = hasFiveYear ? originalCost.minus(RESIDUAL_VALUE) : limit;
  const fiveYearBase = originalCost.minus(limit).minus(RESIDUAL_VALUE);
  const fiveYearAmount = fiveYearBase.dividedBy(OLD_METHOD_FIVE_YEAR_DIVISOR).toDecimalPlaces(0);
  const straightAmount = isDeclining
    ? D(0)
    : originalCost
        .minus(oldMethodResidualValue(originalCost, asset))
        .times(oldStraightLineRate(asset.usefulLifeYears))
        .toDecimalPlaces(0);
  const disposedYear = asset.disposedDate ? Number(asset.disposedDate.slice(0, 4)) : null;
  const disposedMonth = asset.disposedDate ? Number(asset.disposedDate.slice(5, 7)) : 12;

  let accumulated = D(0);
  for (let y = acqYear; y <= year; y++) {
    const monthsThisYear = activeMonths(y, acqYear, acqMonth, disposedYear, disposedMonth);
    const deemedTotal = preConversionDeemed.plus(accumulated);
    const inFiveYear = hasFiveYear && deemedTotal.greaterThanOrEqualTo(limit);
    let fullAmount: Decimal;
    let base: Decimal;
    if (inFiveYear) {
      fullAmount = y < OLD_METHOD_FIVE_YEAR_START ? D(0) : fiveYearAmount;
      base = fiveYearBase;
    } else if (isDeclining) {
      base = cost.minus(accumulated);
      fullAmount = base.times(decliningRate ?? '0').toDecimalPlaces(0);
    } else {
      base = originalCost.minus(oldMethodResidualValue(originalCost, asset));
      fullAmount = straightAmount;
    }
    let yearAmount = fullAmount.times(monthsThisYear).dividedBy(12).toDecimalPlaces(0);
    const remaining = (inFiveYear ? finalLimit : limit).minus(deemedTotal);
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
        fullyDepreciated: preConversionDeemed.plus(accumulatedEnd).equals(finalLimit),
        depreciationBase: base.toString(),
      };
    }
    accumulated = accumulated.plus(yearAmount);
  }
  return {
    amount: '0',
    accumulatedEnd: accumulated.toString(),
    bookValueEnd: cost.minus(accumulated).toString(),
    fullyDepreciated: false,
    depreciationBase: cost.toString(),
  };
}
// リース期間定額法（所令120条の2第1項6号）：年額 = 取得価額（令和9年3月31日以前締結・残価保証額
// ありは減じた額）÷ リース期間月数 × 当年のリース期間月数。
function computeLeasePeriodStraightLine(
  asset: FixedAsset,
  year: number,
  acqYear: number,
  acqMonth: number,
): DepreciationResult {
  const cost = D(depreciableCost(asset));
  const leaseTermMonths = asset.leaseTermMonths ?? 0;
  const hasResidualGuarantee =
    asset.leaseContractDate !== undefined &&
    asset.residualGuaranteeAmount !== undefined &&
    asset.leaseContractDate <= LEASE_RESIDUAL_GUARANTEE_DEADLINE;
  const base = hasResidualGuarantee ? cost.minus(asset.residualGuaranteeAmount!) : cost;
  const floor = cost.minus(base);
  const disposedYear = asset.disposedDate ? Number(asset.disposedDate.slice(0, 4)) : null;
  const disposedMonth = asset.disposedDate ? Number(asset.disposedDate.slice(5, 7)) : 12;

  let accumulated = D(0);
  for (let y = acqYear; y <= year; y++) {
    const monthsThisYear = activeMonths(y, acqYear, acqMonth, disposedYear, disposedMonth);
    let yearAmount =
      leaseTermMonths > 0
        ? base.times(monthsThisYear).dividedBy(leaseTermMonths).toDecimalPlaces(0)
        : D(0);
    const remaining = base.minus(accumulated);
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
        fullyDepreciated: bookValueEnd.equals(floor),
        depreciationBase: base.toString(),
      };
    }
    accumulated = accumulated.plus(yearAmount);
  }
  return {
    amount: '0',
    accumulatedEnd: accumulated.toString(),
    bookValueEnd: cost.minus(accumulated).toString(),
    fullyDepreciated: false,
    depreciationBase: base.toString(),
  };
}
interface YearEndDepreciationResult {
  /** 仕訳を新規作成した件数 */
  created: number;
  /** 既存仕訳があり重複回避でスキップした件数 */
  skipped: number;
  /** 少額特例だが年合計 300 万円 cap で適用不可となった件数（仕訳未作成） */
  smallAssetCapExceeded: number;
  /** 少額特例として設定されているが取得日・価額が要件外で適用不可の件数（仕訳未作成） */
  smallAssetIneligible: number;
}

// 全年度分の開業仕訳のうち最も古い日付を開業日とみなす。開業設定を使っていなければ undefined（全年扱い）。
async function earliestOpeningDate(): Promise<string | undefined> {
  const openings = await db.journalEntries
    .filter((e) => e.source === 'opening' && countsTowardTotals(e))
    .toArray();
  return openings.map((e) => e.date).sort()[0];
}
// 指定年度の全資産の償却仕訳をまとめて作成する。
// 既に同じ assetId + year の仕訳が存在する場合はスキップ（重複作成防止）。
// 少額減価償却資産の特例：年合計 300 万円 cap を超える資産・要件外の資産は、所令125条2号イにより
// 定額法／定率法（decliningBalanceElected）に切り替えて通常償却を計上する（措法28の2のまとめ行からは外れる）。
export async function generateYearEndDepreciation(
  year: number,
  options?: {
    allowFiledYear?: boolean;
    /** 未指定は開業仕訳の日付（無ければ全年扱い） */
    businessStartDate?: string;
    /** 未指定は廃業なし（全年扱い） */
    businessCloseDate?: string;
  },
): Promise<YearEndDepreciationResult> {
  await assertYearsWritable([year], options);
  const assets = await db.fixedAssets.toArray();
  const pools = lumpSumPoolShares(assets);
  const businessStartDate = options?.businessStartDate ?? (await earliestOpeningDate());
  const businessCloseDate = options?.businessCloseDate;
  const statuses = smallAssetSpecialStatuses(assets, businessStartDate, businessCloseDate);
  const date = `${year}-12-31`;
  const now = Date.now();

  let created = 0;
  let skipped = 0;
  let smallAssetCapExceeded = 0;
  let smallAssetIneligible = 0;

  for (const asset of assets) {
    const isSmallCandidate = isSmallAssetSpecialCandidate(asset, year);
    const status = isSmallCandidate ? statuses.get(asset.id) : undefined;
    if (status === 'ineligible') {
      smallAssetIneligible++;
    } else if (status === 'cap-exceeded') {
      smallAssetCapExceeded++;
    }

    const result = computeDepreciation(asset, year, pools.get(asset.id), statuses);
    if (D(result.amount).isZero()) {
      continue;
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
          e.description.includes('減価償却'),
      )
      .first();
    if (existing) {
      skipped++;
      continue;
    }

    const entryId = newId();
    const tag = `${asset.name} #${asset.id.slice(0, 8)}`;
    const description =
      status === 'applicable'
        ? `減価償却（措法28の2）${tag}`
        : isImmediateExpenseAsset(asset)
          ? `減価償却（所令138）${tag}`
          : `減価償却 ${tag}`;
    await db.transaction('rw', [db.journalEntries, db.journalLines], async () => {
      markConfirmedWrite(options);
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
    });
    created++;
  }

  return { created, skipped, smallAssetCapExceeded, smallAssetIneligible };
}
