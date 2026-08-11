// 自動バックアップの実行間隔と、端末外バックアップの催促を判定する純ロジック。
// ブラウザ API に触れないため、アダプタ実装と切り離して単体テストできる。
export const BACKUP_INTERVAL_HOURS = [0, 1, 3, 5, 12, 24] as const;
export type BackupIntervalHours = (typeof BACKUP_INTERVAL_HOURS)[number];

export const BACKUP_RETENTION_COUNTS = [0, 7, 30, 90] as const;
export type BackupRetentionCount = (typeof BACKUP_RETENTION_COUNTS)[number];

const HOUR_MS = 60 * 60 * 1000;
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
export function daysSince(ts: number | null): number | null {
  if (!ts) {
    return null;
  }
  return Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
}

const OFFSITE_WARNING_DAYS = 7;
// フォルダへの自動保存が「現に動いている」か。アダプタの種類だけでは足りない：
// 未設定・再選択待ちのときは種類が fsa/native でも一件も書き出されていない。
export function isFolderBackupActive(adapterKind: string, status: string): boolean {
  return (
    (adapterKind === 'fsa' || adapterKind === 'native') &&
    (status === 'idle' || status === 'writing')
  );
}
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
  if (isFolderBackupActive(adapterKind, status)) {
    return false;
  }
  return daysSinceDownload === null || daysSinceDownload >= OFFSITE_WARNING_DAYS;
}
// 一部の環境で永続化ストレージが得られる唯一の一般経路はホーム画面への追加。
// フォルダ保存が動いている環境やすでにホーム画面起動済みの環境では案内不要。
export function shouldShowHomeScreenHint(adapterKind: string, isStandalone: boolean): boolean {
  if (isStandalone) {
    return false;
  }
  return adapterKind !== 'fsa' && adapterKind !== 'native';
}
