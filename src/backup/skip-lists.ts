import type { SettingsMap } from '../lib/settings';
// 書き出し（payload.ts）と復元（domain/restore.ts）が同じ一覧を見る。片側だけに足すと、
// 手で書き換えたバックアップから端末固有の値を持ち込めてしまう。
// restore-validate.ts から使うので db を import しない。
//
// 書き出さず、復元でも取り込まず、この端末の値（無ければ無いまま）を残す settings キー。
// - backupFolderHandle：FileSystemDirectoryHandle でシリアライズできない
// - nativeBackupFolder：端末固有（パス / security-scoped bookmark）で、別端末では
//   存在しない場所や他人のフォルダを指し得る
// - supporterBadgeAt：ストアから復元するもの。運ぶと買っていない端末へ持ち込める
// - analysisNotifyEnabled：端末ごとの通知許可に紐づく
// - lastBackupAt / lastDownloadAt / lastBlobSweepAt：この端末で保存・掃除した記録。
//   持ち込むと、一度もダウンロードしていない端末で端末外バックアップの警告が消える
// - backupRetentionCount / blobRetentionDays：保存先フォルダに残す控えの件数と日数。
//   バックアップから決められると、その保存先の控えを消させられる
export const SKIP_SETTING_KEYS: ReadonlySet<keyof SettingsMap> = new Set<keyof SettingsMap>([
  'backupFolderHandle',
  'nativeBackupFolder',
  'supporterBadgeAt',
  'analysisNotifyEnabled',
  'lastBackupAt',
  'lastDownloadAt',
  'lastBlobSweepAt',
  'backupRetentionCount',
  'blobRetentionDays',
]);
// 復元では取り込まず、この端末の値も戻さない（復元後は未設定になる）settings キー。
// 書き出しには残す。外すとバックアップの形式が変わるため。
// - skipExternalSendConfirm：取り込むと、バックアップが選んだ送信先への送信を
//   確認なしで承認させられる。復元後は次の外部送信の前にもう一度確認する
export const RESET_ON_RESTORE_KEYS: ReadonlySet<keyof SettingsMap> = new Set<keyof SettingsMap>([
  'skipExternalSendConfirm',
]);
// 書き出さず、復元でも取り込まず、この端末の行をそのまま残すテーブル。
// - stamps：この端末だけの記録だと画面で言っている
export const SKIP_TABLES: ReadonlySet<string> = new Set(['stamps']);
// settings の主キーは検証後も number があり得る（restore-validate.ts の validateGeneric）。
// 文字列と確かめてから引く。
export function hasSettingKey(set: ReadonlySet<keyof SettingsMap>, key: unknown): boolean {
  return typeof key === 'string' && (set as ReadonlySet<string>).has(key);
}
