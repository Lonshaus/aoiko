// 自動バックアップの実行間隔と、古いバックアップの汰換を判定する純ロジック。
// ブラウザ API に触れないため、アダプタ実装と切り離して単体テストできる。
export const BACKUP_INTERVAL_HOURS = [0, 1, 3, 5, 12, 24] as const;
export type BackupIntervalHours = (typeof BACKUP_INTERVAL_HOURS)[number];

export const BACKUP_RETENTION_COUNTS = [0, 7, 30, 90] as const;
export type BackupRetentionCount = (typeof BACKUP_RETENTION_COUNTS)[number];

const HOUR_MS = 60 * 60 * 1000;
// 日付入りの名前だけを汰換対象にする。OPFS が併置する固定名
// （aoiko-ledger-latest.zip）は復元の起点なので決して削除しない。
const DATED_BACKUP_PATTERN = /^aoiko-ledger-\d{4}-\d{2}-\d{2}\.zip$/;

// intervalHours = 0 は「変更のたび」（既定・従来動作）。
// 引数は number で受ける。UI が出す選択肢が変わってもこの判定は変えなくてよい。
export function shouldBackupNow(
  lastBackupAt: number | null,
  now: number,
  intervalHours: number,
): boolean {
  if (intervalHours === 0 || lastBackupAt === null) {
    return true;
  }
  // 端末の時計が巻き戻された場合は経過時間を信用できないので、保存する側に倒す。
  if (now < lastBackupAt) {
    return true;
  }
  return now - lastBackupAt >= intervalHours * HOUR_MS;
}

// keepCount = 0 は「削除しない」（既定・従来動作）。戻り値は削除すべきファイル名。
export function selectExpiredBackups(fileNames: readonly string[], keepCount: number): string[] {
  if (keepCount === 0) {
    return [];
  }
  // 日付部分は YYYY-MM-DD の固定長なので、辞書順がそのまま日付順になる。
  const dated = fileNames.filter((name) => DATED_BACKUP_PATTERN.test(name)).sort();
  if (dated.length <= keepCount) {
    return [];
  }
  return dated.slice(0, dated.length - keepCount);
}

export function daysSince(ts: number | null): number | null {
  if (!ts) {
    return null;
  }
  return Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
}

export const OFFSITE_WARNING_DAYS = 7;
// 端末外に控えがあると言えるのは、利用者が選んだフォルダへの自動保存が現に
// 動いている場合だけ。OPFS はブラウザ管理領域でサイトデータ削除と運命を共にし、
// フォルダ未設定・ブラウザ非対応はそもそも自動保存が無い。どの場合も手動
// ダウンロードしか端末外へ出る経路がないため、同じ基準で警告する。
export function needsOffsiteBackupWarning(
  adapterKind: string,
  status: string,
  daysSinceDownload: number | null,
): boolean {
  if (status === 'initializing') {
    return false;
  }
  if (adapterKind === 'fsa' && (status === 'idle' || status === 'writing')) {
    return false;
  }
  return daysSinceDownload === null || daysSinceDownload >= OFFSITE_WARNING_DAYS;
}
