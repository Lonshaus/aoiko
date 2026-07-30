// 大量行の表示をページ単位に区切るための純粋な算術ヘルパー。

export function pageCount(total: number, pageSize: number): number {
  if (total <= 0 || pageSize <= 0) {
    return 1;
  }
  return Math.ceil(total / pageSize);
}
// 範囲外・負の入力を有効なページ番号へ丸める。
export function clampPage(page: number, total: number, pageSize: number): number {
  const last = pageCount(total, pageSize) - 1;
  if (page < 0) {
    return 0;
  }
  if (page > last) {
    return last;
  }
  return page;
}
// [start, end) の半開区間。end は total を超えない。
export function pageBounds(
  total: number,
  pageSize: number,
  page: number,
): { start: number; end: number } {
  if (total <= 0 || pageSize <= 0) {
    return { start: 0, end: 0 };
  }
  const clamped = clampPage(page, total, pageSize);
  const start = clamped * pageSize;
  const end = Math.min(start + pageSize, total);
  return { start, end };
}
