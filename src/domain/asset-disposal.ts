import { D, Decimal } from '../lib/decimal';
import { toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { db } from '../db/db';
import { countsTowardTotals } from './journal';
import { assertYearsWritable, markConfirmedWrite } from './year-lock';
import {
  computeDepreciation,
  depreciableCost,
  isImmediateExpenseAsset,
  smallAssetSpecialStatuses,
  type LumpSumPoolShare,
  type SmallAssetStatus,
} from './depreciation';
import { SMALL_ASSET_MIN } from '../tax-schema/2026/limits';
import { loadBusinessDates } from '../lib/settings';
import type { DisposalType, FixedAsset, JournalEntry, JournalLine } from '../db/types';
import { m } from '../paraglide/messages';
// 固定資産の除却・売却（B6）。
//
// 除却（対価なし）：帳簿価額（未償却残高）全額を必要経費「固定資産除却損」に計上する。
// 三社（freee/やよい/MFクラウド）とも扱いは一致。
//
// 売却（対価あり）：個人事業主の事業用資産売却は事業所得ではなく譲渡所得（総合課税、
// 所法33条・22条2項）に該当し、損益計算書に含めてはいけない。freee 方式（事業主貸/事業主借で
// 売却対価と帳簿価額の差額を精算し、損益計算書に一切触れない）を採用した。理由：
//   - aoiko は既に事業主貸/事業主借を「事業と個人の境界を跨ぐ取引」の精算に
//     使っており（家事按分・年末元入金振替）、資産売却も同じ性質の取引として
//     構造的に一貫する
//   - 通用（MF系）の「固定資産売却損益」科目方式は、損益表科目でありながら
//     事業所得の集計からは除外する必要があり、その除外ロジックを新しい集計機能
//     （報表・xtx出力）を追加するたびに書き漏らすリスクがある
// 譲渡所得の試算は資産単位の estimateTransferIncome() と年分集計の aggregateTransferIncome() で
// 参考値として提供する（確定申告書第一表・第二表の総合譲渡欄へは利用者が転記する）。
//
// 一括償却資産（施行令139条）は除却・売却後も3年均等償却を継続し、未償却残高の一時損金算入は
// できない。所令81条3号により譲渡所得の基因とならないため、売却対価は事業の雑収入に計上し、
// 除却は仕訳を作らない（業務の性質上基本的に重要なものは対象外だが、その区分は持たない）。

const DISPOSAL_LOSS_ACCOUNT = '5280';
const ACCUMULATED_DEPRECIATION_ACCOUNT = '1520';
const OWNER_DRAW_ACCOUNT = '1610'; // 事業主貸
const OWNER_CONTRIBUTION_ACCOUNT = '3120'; // 事業主借
const DEFAULT_CASH_ACCOUNT = '1110';
const MISC_INCOME_ACCOUNT = '4910';
const MISC_INCOME_REAL_ESTATE_ACCOUNT = '4920';
// 所法33条3項1号：取得の日以後 5 年以内の譲渡は短期。
const SHORT_TERM_HOLDING_YEARS = 5;
// 所法33条4項の譲渡所得の特別控除額。
const TRANSFER_SPECIAL_DEDUCTION = 500_000;

const DISPOSAL_MARKER: Record<DisposalType, string> = {
  scrap: '固定資産除却',
  sale: '固定資産売却',
};

interface DisposalLineSpec {
  side: 'debit' | 'credit';
  accountCode: string;
  amount: string;
  /** 課税資産の譲渡等の対価（消法28条1項）。事業用資産の売却は付随行為として課税対象（消令2条3項） */
  taxableTransferConsideration?: string;
  taxRate?: number;
  taxIncluded?: boolean;
}
// 除却/売却時点（disposedDate の年）における累計償却額・帳簿価額を返す。
// smallAssetStatuses は少額特例の落選判定（generateYearEndDepreciation と同じ算出）。未指定は既存データ互換。
export function disposalBookValue(
  asset: FixedAsset,
  lumpSumPool?: LumpSumPoolShare,
  smallAssetStatuses?: ReadonlyMap<string, SmallAssetStatus>,
): {
  accumulatedEnd: string;
  bookValueEnd: string;
} {
  if (!asset.disposedDate) {
    throw new Error(m.error_disposed_date_unset());
  }
  const disposedYear = Number(asset.disposedDate.slice(0, 4));
  const result = computeDepreciation(asset, disposedYear, lumpSumPool, smallAssetStatuses);
  return { accumulatedEnd: result.accumulatedEnd, bookValueEnd: result.bookValueEnd };
}
// 所令81条2号・3号で譲渡所得の基因とならない資産の判定。
// 2号（138条資産）：使用可能期間1年未満は常に除外。原始取得価額10万円未満かつ業務上基本的に重要（essentialToBusiness）
// のときのみ譲渡所得の対象（所得税基本通達33-1の3）。3号（一括償却資産）：essentialToBusiness のときのみ対象。
function isExcludedFromTransferIncome(asset: FixedAsset): boolean {
  if (asset.depreciationMethod === 'lump-sum') {
    return asset.essentialToBusiness !== true;
  }
  if (isImmediateExpenseAsset(asset)) {
    if (
      asset.usableLifeUnderOneYear !== true &&
      asset.essentialToBusiness === true &&
      D(asset.acquisitionCost).lessThan(SMALL_ASSET_MIN)
    ) {
      return false;
    }
    return true;
  }
  return false;
}
// 一括償却資産の除却は仕訳不要（3 年均等償却を継続する）。売却は原則事業の雑収入だが、
// 業務上基本的に重要な資産（essentialToBusiness）の売却は譲渡所得の対象のため、
// 事業主借で精算し事業の損益に含めない（一般資産の売却と同じ扱い）。
function buildLumpSumDisposalLines(asset: FixedAsset, cashAccountCode: string): DisposalLineSpec[] {
  if ((asset.disposalType ?? 'scrap') === 'scrap') {
    return [];
  }
  if (!asset.salePrice) {
    throw new Error(m.error_sale_price_required());
  }
  const salePrice = D(asset.salePrice).toString();
  if (asset.essentialToBusiness === true) {
    return [
      { side: 'debit', accountCode: cashAccountCode, amount: salePrice },
      {
        side: 'credit',
        accountCode: OWNER_CONTRIBUTION_ACCOUNT,
        amount: salePrice,
        taxableTransferConsideration: salePrice,
        taxRate: 0.1,
        taxIncluded: true,
      },
    ];
  }
  const incomeAccount =
    asset.incomeType === 'realEstate' ? MISC_INCOME_REAL_ESTATE_ACCOUNT : MISC_INCOME_ACCOUNT;
  return [
    { side: 'debit', accountCode: cashAccountCode, amount: salePrice },
    {
      side: 'credit',
      accountCode: incomeAccount,
      amount: salePrice,
      taxableTransferConsideration: salePrice,
      taxRate: 0.1,
      taxIncluded: true,
    },
  ];
}
// 除却/売却の仕訳明細を組み立てる純粋関数（DB へは書き込まない）。
export function buildDisposalLines(
  asset: FixedAsset,
  cashAccountCode: string = DEFAULT_CASH_ACCOUNT,
  smallAssetStatuses?: ReadonlyMap<string, SmallAssetStatus>,
): DisposalLineSpec[] {
  if (asset.depreciationMethod === 'lump-sum') {
    return buildLumpSumDisposalLines(asset, cashAccountCode);
  }
  const { accumulatedEnd, bookValueEnd } = disposalBookValue(asset, undefined, smallAssetStatuses);
  const cost = D(depreciableCost(asset));
  const disposalType: DisposalType = asset.disposalType ?? 'scrap';

  if (disposalType === 'sale') {
    if (!asset.salePrice) {
      throw new Error(m.error_sale_price_required());
    }
    const salePrice = D(asset.salePrice);
    const diff = salePrice.minus(bookValueEnd);
    const lines: DisposalLineSpec[] = [
      { side: 'debit', accountCode: cashAccountCode, amount: salePrice.toString() },
    ];
    if (D(accumulatedEnd).greaterThan(0)) {
      lines.push({
        side: 'debit',
        accountCode: ACCUMULATED_DEPRECIATION_ACCOUNT,
        amount: accumulatedEnd,
      });
    }
    if (diff.greaterThan(0)) {
      lines.push({
        side: 'credit',
        accountCode: OWNER_CONTRIBUTION_ACCOUNT,
        amount: diff.toString(),
      });
    } else if (diff.lessThan(0)) {
      lines.push({ side: 'debit', accountCode: OWNER_DRAW_ACCOUNT, amount: diff.abs().toString() });
    }
    // 事業用資産の売却は付随行為として課税資産の譲渡等（消令2条3項・消法28条1項、課税標準は税込対価）。
    lines.push({
      side: 'credit',
      accountCode: asset.accountCode,
      amount: cost.toString(),
      taxableTransferConsideration: salePrice.toString(),
      taxRate: 0.1,
      taxIncluded: true,
    });
    return lines;
  }

  const lines: DisposalLineSpec[] = [];
  if (D(bookValueEnd).greaterThan(0)) {
    lines.push({ side: 'debit', accountCode: DISPOSAL_LOSS_ACCOUNT, amount: bookValueEnd });
  }
  if (D(accumulatedEnd).greaterThan(0)) {
    lines.push({
      side: 'debit',
      accountCode: ACCUMULATED_DEPRECIATION_ACCOUNT,
      amount: accumulatedEnd,
    });
  }
  lines.push({ side: 'credit', accountCode: asset.accountCode, amount: cost.toString() });
  return lines;
}

interface DisposalEntryResult {
  created: boolean;
  reason?:
    | 'no-disposal'
    | 'already-exists'
    | 'missing-sale-price'
    | 'lump-sum-scrap-no-entry'
    | 'needs-year-end-depreciation';
}
// 除却/売却の仕訳を実際に作成する。既に同じ資産・同マーカーの仕訳がある場合はスキップ
// （generateYearEndDepreciation と同じ重複防止パターン）。
export async function generateDisposalEntry(
  assetId: string,
  cashAccountCode: string = DEFAULT_CASH_ACCOUNT,
  options?: { allowFiledYear?: boolean },
): Promise<DisposalEntryResult> {
  const asset = await db.fixedAssets.get(assetId);
  const disposedDate = asset?.disposedDate;
  if (!asset || !disposedDate) {
    return { created: false, reason: 'no-disposal' };
  }
  // 書く年度は除却日で決まる。引数からは分からないので資産を引いた後で判定する。
  await assertYearsWritable([Number(disposedDate.slice(0, 4))], options);
  const disposalType: DisposalType = asset.disposalType ?? 'scrap';
  if (asset.depreciationMethod === 'lump-sum' && disposalType === 'scrap') {
    return { created: false, reason: 'lump-sum-scrap-no-entry' };
  }
  if (disposalType === 'sale' && !asset.salePrice) {
    return { created: false, reason: 'missing-sale-price' };
  }

  const year = Number(disposedDate.slice(0, 4));
  const tag = `#${asset.id.slice(0, 8)}`;
  const marker = DISPOSAL_MARKER[disposalType];

  const existing = await db.journalEntries
    .where('[year+date]')
    .equals([year, disposedDate])
    .filter(
      (e) => countsTowardTotals(e) && e.description.includes(tag) && e.description.includes(marker),
    )
    .first();
  if (existing) {
    return { created: false, reason: 'already-exists' };
  }
  // 少額特例の落選判定（cap 超過・要件外）は全資産・開業日／廃業日に依るので、ここで DB から読んで算出する。
  const [allAssets, businessDates] = await Promise.all([
    db.fixedAssets.toArray(),
    loadBusinessDates(),
  ]);
  const statuses = smallAssetSpecialStatuses(
    allAssets,
    businessDates.businessStartDate,
    businessDates.businessCloseDate,
  );
  // 除却仕訳は当年の月按分を含む累計償却額を貸方で落とすが、その当年分は 12/31 の
  // 年末一括償却仕訳の借方があって初めて釣り合う。順序が逆だと累計償却額が負残高になり、
  // 費用も同額少なくなる。両者は設定画面の独立したボタンなので、ここで順序を担保する。
  const currentYearDepreciation = computeDepreciation(asset, year, undefined, statuses);
  // 一括償却資産は除却後も償却を続け、売却仕訳は累計償却額に触れないので順序の制約が無い。
  if (asset.depreciationMethod !== 'lump-sum' && !D(currentYearDepreciation.amount).isZero()) {
    const yearEnd = await db.journalEntries
      .where('[year+date]')
      .equals([year, `${year}-12-31`])
      .filter(
        (e) =>
          countsTowardTotals(e) &&
          e.description.includes(tag) &&
          e.description.includes('減価償却'),
      )
      .first();
    if (!yearEnd) {
      return { created: false, reason: 'needs-year-end-depreciation' };
    }
  }

  const lines = buildDisposalLines(asset, cashAccountCode, statuses);
  const entryId = newId();
  const now = Date.now();
  const description = `${marker} ${asset.name} ${tag}`;

  await db.transaction('rw', [db.journalEntries, db.journalLines], async () => {
    markConfirmedWrite(options);
    await db.journalEntries.add({
      id: entryId,
      date: disposedDate,
      year,
      description,
      status: 'confirmed',
      source: 'manual',
      createdAt: now,
      confirmedAt: now,
    } satisfies JournalEntry);

    const journalLines: JournalLine[] = lines.map((l) => ({
      id: newId(),
      entryId,
      side: l.side,
      accountCode: l.accountCode,
      amount: l.amount,
      amountIndexed: toIndexable(l.amount),
      taxRate: l.taxRate ?? 0,
      taxIncluded: l.taxIncluded ?? true,
      invoiceCompliant: false,
      ...(l.taxableTransferConsideration !== undefined
        ? { taxableTransferConsideration: l.taxableTransferConsideration }
        : {}),
    }));
    await db.journalLines.bulkAdd(journalLines);
  });

  return { created: true };
}

interface TransferIncomeEstimate {
  proceeds: string;
  acquisitionExpense: string;
  saleExpenses: string;
  /** 概算譲渡所得 = 譲渡収入 − 取得費（帳簿価額） − 譲渡費用。特別控除は未反映 */
  estimate: string;
  /** 取得日から売却日までの満年数（5 年以下は短期、所法33条3項1号） */
  holdingYears: number;
}
// 取得日から処分日までの満年数（応当日基準の暦計算）。総合課税の譲渡所得の
// 短期/長期判定は 365.25 日平均ではなく暦の 5 年境界で行うため、月日で応当日を判定する。
// 2/29 取得を平年に処分した場合、同月内の月日比較（2/28 < 2/29）が自然に未到達となり、
// 民法の月末満了慣例（応当日翌日 3/1 到来をもって満了）と一致する。
function fullYearsBetween(acquisitionDate: string, disposedDate: string): number {
  const [ay, am, ad] = acquisitionDate.split('-').map(Number);
  const [dy, dm, dd] = disposedDate.split('-').map(Number);
  let years = dy! - ay!;
  if (dm! < am! || (dm === am && dd! < ad!)) {
    years -= 1;
  }
  return years;
}
// 譲渡所得の参考試算（総合課税、事業所得には含めない）。特別控除と短期・長期の通算は aggregateTransferIncome() で行う。
// 一括償却資産（essentialToBusiness で譲渡所得対象になった場合）は所基通49-40の2・質疑応答事例04/04により
// 個別資産の取得価額を取得費として控除できない（3年均等償却を継続するため）ので取得費は 0 とする。
export function estimateTransferIncome(
  asset: FixedAsset,
  smallAssetStatuses?: ReadonlyMap<string, SmallAssetStatus>,
): TransferIncomeEstimate | null {
  if (asset.disposalType !== 'sale' || !asset.disposedDate || !asset.salePrice) {
    return null;
  }
  if (isExcludedFromTransferIncome(asset)) {
    return null;
  }
  const proceeds = D(asset.salePrice);
  const saleExpenses = D(asset.saleExpenses ?? '0');
  const acquisitionExpense =
    asset.depreciationMethod === 'lump-sum'
      ? '0'
      : disposalBookValue(asset, undefined, smallAssetStatuses).bookValueEnd;
  const estimate = proceeds.minus(acquisitionExpense).minus(saleExpenses);
  const holdingYears = fullYearsBetween(asset.acquisitionDate, asset.disposedDate);
  return {
    proceeds: proceeds.toString(),
    acquisitionExpense,
    saleExpenses: saleExpenses.toString(),
    estimate: estimate.toString(),
    holdingYears,
  };
}

interface TransferIncomeAggregateInput {
  /** 短期（所法33条3項1号）の総収入金額 − 取得費 − 譲渡費用。損失は負 */
  shortTerm: string;
  /** 長期（同項2号）の総収入金額 − 取得費 − 譲渡費用。損失は負 */
  longTerm: string;
  /** 一時所得の金額（所法34条2項の特別控除後）。未指定は 0 */
  occasionalIncome?: string;
}

export interface TransferIncomeAggregate {
  /** 所法33条3項柱書の通算後の譲渡益 */
  gain: string;
  /** 所法33条4項の特別控除額 */
  specialDeduction: string;
  /** 短期譲渡所得の金額（総所得金額に全額算入） */
  shortTermIncome: string;
  /** 長期譲渡所得の金額 */
  longTermIncome: string;
  /** 所法22条2項2号：長期譲渡所得と一時所得の合計額の 1/2 */
  halfOfLongTermAndOccasional: string;
}
// 年分の譲渡所得の金額（所法33条3項〜5項）と総所得金額への算入額（所法22条2項）。
export function aggregateTransferIncome(
  input: TransferIncomeAggregateInput,
): TransferIncomeAggregate {
  let shortTerm = D(input.shortTerm);
  let longTerm = D(input.longTerm);
  if (shortTerm.isNegative() && longTerm.isPositive()) {
    const offset = Decimal.min(shortTerm.negated(), longTerm);
    shortTerm = shortTerm.plus(offset);
    longTerm = longTerm.minus(offset);
  } else if (longTerm.isNegative() && shortTerm.isPositive()) {
    const offset = Decimal.min(longTerm.negated(), shortTerm);
    longTerm = longTerm.plus(offset);
    shortTerm = shortTerm.minus(offset);
  }
  const gain = Decimal.max(shortTerm, 0).plus(Decimal.max(longTerm, 0));
  const specialDeduction = Decimal.min(TRANSFER_SPECIAL_DEDUCTION, gain);
  const fromShort = Decimal.min(specialDeduction, Decimal.max(shortTerm, 0));
  const fromLong = specialDeduction.minus(fromShort);
  const shortTermIncome = shortTerm.minus(fromShort);
  const longTermIncome = longTerm.minus(fromLong);
  const combined = longTermIncome.plus(input.occasionalIncome ?? '0');
  const half = Decimal.max(combined, 0).dividedBy(2).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  return {
    gain: gain.toString(),
    specialDeduction: specialDeduction.toString(),
    shortTermIncome: shortTermIncome.toString(),
    longTermIncome: longTermIncome.toString(),
    halfOfLongTermAndOccasional: half.toString(),
  };
}
// 指定年に売却した資産の譲渡益を短期・長期に振り分ける（aggregateTransferIncome の入力）。
export function transferIncomeByTerm(
  assets: readonly FixedAsset[],
  year: number,
  smallAssetStatuses?: ReadonlyMap<string, SmallAssetStatus>,
): { shortTerm: string; longTerm: string; count: number } {
  let shortTerm = D(0);
  let longTerm = D(0);
  let count = 0;
  for (const asset of assets) {
    if (!asset.disposedDate || Number(asset.disposedDate.slice(0, 4)) !== year) {
      continue;
    }
    const estimate = estimateTransferIncome(asset, smallAssetStatuses);
    if (!estimate) {
      continue;
    }
    count++;
    if (estimate.holdingYears < SHORT_TERM_HOLDING_YEARS) {
      shortTerm = shortTerm.plus(estimate.estimate);
    } else {
      longTerm = longTerm.plus(estimate.estimate);
    }
  }
  return { shortTerm: shortTerm.toString(), longTerm: longTerm.toString(), count };
}
