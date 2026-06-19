import { db } from '../db/db';
import type { BackupPayload } from './types';
// シリアライズ不可能な settings キー（常にバックアップ対象外）
const SKIP_SETTING_KEYS = new Set(['backupFolderHandle']);
// API キー（平文）。既定では除外し、利用者が明示的に含めると選択した場合のみ書き出す。
const SENSITIVE_SETTING_KEYS = new Set(['geminiApiKey', 'openaiApiKey']);

export const PAYLOAD_VERSION = 1;

export interface BuildPayloadOptions {
  // API キーをバックアップに含めるか（既定 false）
  includeApiKeys?: boolean;
}

export async function buildPayload(options: BuildPayloadOptions = {}): Promise<BackupPayload> {
  const includeApiKeys = options.includeApiKeys ?? false;
  const tables: Record<string, unknown[]> = {};
  for (const t of db.tables) {
    let rows = await t.toArray();
    if (t.name === 'settings') {
      rows = rows.filter((r) => {
        const key = (r as { key: string }).key;
        if (SKIP_SETTING_KEYS.has(key)) {
          return false;
        }
        if (!includeApiKeys && SENSITIVE_SETTING_KEYS.has(key)) {
          return false;
        }
        return true;
      });
    }
    tables[t.name] = rows;
  }
  return {
    version: PAYLOAD_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
  };
}