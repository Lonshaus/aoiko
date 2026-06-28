import { db } from '../db/db';
import { FILER_INFO_SETTING_KEYS, PAYLOAD_VERSION, type BackupPayload } from '../backup';
import { validateBackupPayload } from './restore-validate';

export class IncompatibleBackupError extends Error {
  constructor(public readonly backupVersion: number) {
    super(
      `バックアップ形式バージョン ${backupVersion} は現在の形式 ${PAYLOAD_VERSION} と互換性がありません`
    );
    this.name = 'IncompatibleBackupError';
  }
}
// JSON バックアップの内容で IndexedDB を完全置換する。
// 既存データはすべて削除されるため、UI 側で必ず確認ダイアログを挟むこと。
export async function restoreFromJson(
  payload: BackupPayload
): Promise<{ tableCount: number; rowCount: number }> {
  if (payload.version !== PAYLOAD_VERSION) {
    throw new IncompatibleBackupError(payload.version);
  }
  // 全消去の前に検証する。不正なバックアップで既存データを失わないため。
  validateBackupPayload(payload);
  // 申告者情報（個人情報）はバックアップに含まれないことがある（既定で除外）。
  // バックアップに含まれていない場合は全消去で失わないよう、現在値を退避して復帰する。
  const settingRows = payload.tables['settings'];
  const restoredSettingKeys = new Set(
    Array.isArray(settingRows)
      ? settingRows.map((r) => (r as { key?: string }).key)
      : []
  );
  const preservedFilerSettings = (await db.settings.toArray()).filter(
    (r) => FILER_INFO_SETTING_KEYS.has(r.key) && !restoredSettingKeys.has(r.key)
  );

  await db.delete();
  await db.open();

  let tableCount = 0;
  let rowCount = 0;

  for (const table of db.tables) {
    const rows = payload.tables[table.name];
    if (!Array.isArray(rows) || rows.length === 0) {
      continue;
    }
    await table.bulkPut(rows);
    tableCount++;
    rowCount += rows.length;
  }
  if (preservedFilerSettings.length > 0) {
    await db.settings.bulkPut(preservedFilerSettings);
  }

  return { tableCount, rowCount };
}
// JSON テキストをパース・検証する。形式不正時は throw。
export function parseBackupJson(text: string): BackupPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSON として読み込めませんでした');
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('version' in parsed) ||
    !('tables' in parsed)
  ) {
    throw new Error('バックアップ形式ではありません');
  }
  return parsed as BackupPayload;
}