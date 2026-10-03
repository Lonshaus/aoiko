import type { ArApEntry, Vendor } from '../db/types';
// 旧形式の摘要「番号（取引先 ID）」の ID 部分。新規発行は取引先名を直接保存する
const LEGACY_VENDOR_ID_SUFFIX =
  /（([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})）$/i;
// 旧形式の摘要は表示時に取引先名へ解決する（保存データは移行しない）。取引先が見つからなければ番号だけ残す
export function arApDisplayDescription(
  entry: Pick<ArApEntry, 'description'>,
  vendorsById: ReadonlyMap<string, Pick<Vendor, 'name'>>,
): string {
  const match = LEGACY_VENDOR_ID_SUFFIX.exec(entry.description);
  if (!match) {
    return entry.description;
  }
  const number = entry.description.slice(0, match.index);
  const name = vendorsById.get(match[1]!.toLowerCase())?.name;
  return name ? `${number}（${name}）` : number;
}
