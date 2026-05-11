import { db } from '../db/db';
import { PAYLOAD_VERSION, type BackupPayload } from '../backup';

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