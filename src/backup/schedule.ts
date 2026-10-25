// 端末外バックアップの催促と保持設定の純ロジック。
// ブラウザ API に触れないため、アダプタ実装と切り離して単体テストできる。
export const BACKUP_RETENTION_COUNTS = [0, 7, 30, 90] as const;
export type BackupRetentionCount = (typeof BACKUP_RETENTION_COUNTS)[number];
// 参照されなくなった証憑の実体を消すまでの日数。0 = 消さない（既定）。
export const BLOB_RETENTION_DAYS = [0, 30, 90, 180] as const;
export type BlobRetentionDays = (typeof BLOB_RETENTION_DAYS)[number];
// 保存先の控えを削る設定は、一覧にある値だけを受け付ける。それ以外（型違い・1e-9・
// 一覧外の数）は 0（削除しない）として読む。古いバックアップから入った値もここで 0 として扱う。
export function parseBackupRetentionCount(value: unknown): BackupRetentionCount {
  return BACKUP_RETENTION_COUNTS.find((n) => n === value) ?? 0;
}

export function parseBlobRetentionDays(value: unknown): BlobRetentionDays {
  return BLOB_RETENTION_DAYS.find((n) => n === value) ?? 0;
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
