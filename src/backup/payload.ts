import { db } from '../db/db';
import type { BackupPayload } from './types';
// シリアライズ不可能な settings キー（常にバックアップ対象外）
const SKIP_SETTING_KEYS = new Set(['backupFolderHandle']);
// API キー（平文）。既定では除外し、利用者が明示的に含めると選択した場合のみ書き出す。
const SENSITIVE_SETTING_KEYS = new Set(['geminiApiKey', 'openaiApiKey']);
// 申告者情報（利用者識別番号・氏名・住所・税務署）。個人情報のため既定で除外し、
// 利用者が明示的に含めると選択した場合のみ書き出す。
export const FILER_INFO_SETTING_KEYS = new Set([
  'userRiyoshaId',
  'userFilerName',
  'userFilerZip',
  'userFilerAddress',
  'userZeimushoCode',
  'userZeimushoName',
]);

export const PAYLOAD_VERSION = 1;

export interface BuildPayloadOptions {
  // API キーをバックアップに含めるか（既定 false）
  includeApiKeys?: boolean;
  // 申告者情報をバックアップに含めるか（既定 false）
  includeFilerInfo?: boolean;
}

export async function buildPayload(options: BuildPayloadOptions = {}): Promise<BackupPayload> {
  const includeApiKeys = options.includeApiKeys ?? false;
  const includeFilerInfo = options.includeFilerInfo ?? false;
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
        if (!includeFilerInfo && FILER_INFO_SETTING_KEYS.has(key)) {
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