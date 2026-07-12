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
// 取得日が適用期間内かつ取得価額が閾値未満なら true。
// 青色申告者限定（措法 28 の 2）。呼出元（UI）で filingType==='blue' も確認すること。
export function isSmallAssetEligible(acquisitionDate: string, acquisitionCost: string): boolean {
  if (acquisitionDate > SMALL_ASSET_EXPIRY) {
    return false;
  }
  const cost = Number(acquisitionCost);
  if (!Number.isFinite(cost) || cost < 0) {
    return false;
  }
  return cost < smallAssetThreshold(acquisitionDate);
}
// 一括償却資産（法令138条・所得税法施行令139条）：取得価額10万円以上20万円未満の
// 下限・上限。申告方式（青色/白色）を問わず利用可能。
export const LUMP_SUM_MIN = 100_000;
export const LUMP_SUM_MAX = 200_000;
export function isLumpSumEligible(acquisitionCost: string): boolean {
  const cost = Number(acquisitionCost);
  if (!Number.isFinite(cost)) {
    return false;
  }
  return cost >= LUMP_SUM_MIN && cost < LUMP_SUM_MAX;
}
