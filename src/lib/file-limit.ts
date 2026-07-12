// アップロードファイルのサイズ上限。巨大なファイルでブラウザがフリーズ／OOM するのを防ぐ。
// 純フロントエンドかつ全データがメモリに載るため、リモート攻撃ではなく自衛目的の上限。
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 領収書画像
export const MAX_CSV_BYTES = 50 * 1024 * 1024; // 取引明細 CSV
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024; // 復元用 JSON

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
// 上限超過なら true。呼出元はエラー表示して処理を中断する。
export function exceedsLimit(size: number, limit: number): boolean {
  return size > limit;
}
