import { db } from '../db/db';
import type { BackupPayload } from './types';
// シリアライズ不可能な settings キー（バックアップ対象外）
const SKIP_SETTING_KEYS = new Set(['backupFolderHandle']);

export const PAYLOAD_VERSION = 1;

export async function buildPayload(): Promise<BackupPayload> {
  const tables: Record<string, unknown[]> = {};
  for (const t of db.tables) {
    let rows = await t.toArray();
    if (t.name === 'settings') {
      rows = rows.filter((r) => !SKIP_SETTING_KEYS.has((r as { key: string }).key));
    }
    tables[t.name] = rows;
  }
  return {
    version: PAYLOAD_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
  };
}