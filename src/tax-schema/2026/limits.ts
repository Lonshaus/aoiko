import { D, Decimal } from '../../lib/decimal';
// 少額減価償却資産の特例（措法28の2）の閾値・限度額・適用期限。
// 令和8年度税制改正（2026-04-01 施行）で取得価額の上限が 30 万円未満 → 40 万円未満に引上げ。
// 年間限度額は 300 万円据置、適用期限は令和11年3月31日（2029-03-31）まで 3 年延長。
// 出典：措法 28 の 2 / 国税庁タックスアンサー No.5408 / 弥生 法令ニュース 2026-04-07。
// 取得日に応じた取得価額の閾値（未満）を返す。
// - 2026-03-31 以前 取得：300_000
// - 2026-04-01 以降 取得：400_000
export function smallAssetThreshold(acquisitionDate: string): number {
  return acquisitionDate >= '2026-04-01' ? 400_000 : 300_000;
}
// 年間合計取得価額の上限（青色申告者向け）。
export const SMALL_ASSET_ANNUAL_CAP = 3_000_000;
// 適用期限。これ以降の取得は通常の減価償却に戻る。
export const SMALL_ASSET_EXPIRY = '2029-03-31';
// 措法28の2第1項括弧：取得価額 10 万円未満は所令138条で処理するため特例の対象外。
export const SMALL_ASSET_MIN = 100_000;
// 措令18条の5第1項の常時使用する従業員数の上限。2026-04-01 以後取得分は 400 人（令和8年政令第98号）。
export function smallAssetEmployeeLimit(acquisitionDate: string): number {
  return acquisitionDate >= '2026-04-01' ? 400 : 500;
}

interface SmallAssetConditions {
  /** 未指定は人数要件を満たすものとして扱う（既存データ互換） */
  employeeCount?: number | undefined;
  isLeasedOut?: boolean | undefined;
}

function parseCost(acquisitionCost: string): Decimal | null {
  try {
    const cost = D(acquisitionCost);
    return cost.isFinite() ? cost : null;
  } catch {
    return null;
  }
}
// 青色申告者限定（措法 28 の 2）。呼出元（UI）で filingType==='blue' も確認すること。
export function isSmallAssetEligible(
  acquisitionDate: string,
  acquisitionCost: string,
  conditions: SmallAssetConditions = {},
): boolean {
  if (acquisitionDate > SMALL_ASSET_EXPIRY) {
    return false;
  }
  const cost = parseCost(acquisitionCost);
  if (!cost || cost.isNegative()) {
    return false;
  }
  if (cost.lessThan(SMALL_ASSET_MIN) || !cost.lessThan(smallAssetThreshold(acquisitionDate))) {
    return false;
  }
  if (conditions.isLeasedOut === true && appliesLeasedOutExclusion(acquisitionDate)) {
    return false;
  }
  if (
    conditions.employeeCount !== undefined &&
    conditions.employeeCount > smallAssetEmployeeLimit(acquisitionDate)
  ) {
    return false;
  }
  return true;
}
// 暦に従い 1 月未満の端数を 1 月とする月数（措法28の2第2項・所令137条2項）。to は期間末日の翌日。
export function calendarMonthsCeil(from: string, to: string): number {
  if (to <= from) {
    return 0;
  }
  const [fy = 0, fm = 0, fd = 0] = from.split('-').map(Number);
  const [ty = 0, tm = 0] = to.split('-').map(Number);
  const addMonths = (n: number): string => {
    const y = fy + Math.floor((fm - 1 + n) / 12);
    const mo = ((fm - 1 + n) % 12) + 1;
    const d = Math.min(fd, new Date(y, mo, 0).getDate());
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  let months = (ty - fy) * 12 + (tm - fm);
  if (addMonths(months) > to) {
    months -= 1;
  }
  return addMonths(months) < to ? months + 1 : months;
}

function nextDay(iso: string): string {
  const [y = 0, mo = 0, d = 0] = iso.split('-').map(Number);
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  return next.toISOString().slice(0, 10);
}
// その年の業務期間の月数。開業日・廃業日が同年に無ければ 12（既存データ互換）。
export function businessMonthsInYear(
  year: number,
  businessStartDate?: string,
  businessCloseDate?: string,
): number {
  const from =
    businessStartDate && Number(businessStartDate.slice(0, 4)) === year
      ? businessStartDate
      : `${year}-01-01`;
  const to =
    businessCloseDate && Number(businessCloseDate.slice(0, 4)) === year
      ? nextDay(businessCloseDate)
      : `${year + 1}-01-01`;
  return Math.min(12, calendarMonthsCeil(from, to));
}
// 措法28の2第1項後段：開業年・廃業年は 300 万円を 12 で除し業務期間の月数を乗じた額。
export function smallAssetAnnualCap(
  year: number,
  businessStartDate?: string,
  businessCloseDate?: string,
): Decimal {
  const months = businessMonthsInYear(year, businessStartDate, businessCloseDate);
  return D(SMALL_ASSET_ANNUAL_CAP).dividedBy(12).times(months);
}
interface AssetUseConditions {
  usableLifeUnderOneYear?: boolean | undefined;
  isLeasedOut?: boolean | undefined;
  /** 令和4年政令第136号附則4条・同法律第4号附則31条：貸付けの除外の適用は2022-04-01以後取得分のみ */
  acquisitionDate?: string | undefined;
}
// 令和4年政令第136号附則4条・同法律第4号附則31条：貸付けの除外は2022-04-01以後取得分のみ適用。
// acquisitionDate 未指定時は従来どおり（排除を適用、既存データ互換）。
const LEASED_OUT_EXCLUSION_START = '2022-04-01';
function appliesLeasedOutExclusion(acquisitionDate: string | undefined): boolean {
  return acquisitionDate === undefined || acquisitionDate >= LEASED_OUT_EXCLUSION_START;
}
// 所令138条1項の両支線（10 万円未満・使用可能期間 1 年未満）は「又は」の選択関係。
export function isImmediateExpenseRequired(
  acquisitionCost: string,
  conditions: AssetUseConditions,
): boolean {
  if (conditions.usableLifeUnderOneYear === true) {
    return true;
  }
  const cost = parseCost(acquisitionCost);
  if (!cost || cost.isNegative()) {
    return false;
  }
  const leasedOut =
    conditions.isLeasedOut === true && appliesLeasedOutExclusion(conditions.acquisitionDate);
  return cost.lessThan(SMALL_ASSET_MIN) && !leasedOut;
}
// 一括償却資産（法令138条・所得税法施行令139条）：取得価額10万円以上20万円未満の
// 下限・上限。申告方式（青色/白色）を問わず利用可能。
export const LUMP_SUM_MIN = 100_000;
export const LUMP_SUM_MAX = 200_000;
// 所令139条1項括弧：138条の適用があるもの・主要な業務以外の貸付け用は対象外。
export function isLumpSumEligible(
  acquisitionCost: string,
  conditions: AssetUseConditions = {},
): boolean {
  const cost = parseCost(acquisitionCost);
  if (!cost) {
    return false;
  }
  const leasedOut =
    conditions.isLeasedOut === true && appliesLeasedOutExclusion(conditions.acquisitionDate);
  if (conditions.usableLifeUnderOneYear === true || leasedOut) {
    return false;
  }
  return !cost.lessThan(LUMP_SUM_MIN) && cost.lessThan(LUMP_SUM_MAX);
}
