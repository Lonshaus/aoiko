import { db } from '../db/db';
import type { Attachment } from '../db/types';
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
  // 全テーブルを1つの読み取りトランザクションで揃える。table ごとに await t.toArray()
  // すると Dexie がその都度独立トランザクションを開き、間に書き込みが割り込んで
  // 参照整合性が壊れたスナップショットになる（#316）。写真バイナリの読み出しは
  // iterateAttachmentBlobs で zip ストリーミング中に別途行うため、ここには含めない。
  await db.transaction('r', db.tables, async () => {
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
      if (t.name === 'attachments') {
        // Blob は JSON.stringify 不可。メタデータのみ tables に残し、実体バイナリは
        // zip の attachments/<id> に別途同梱する（buildBackupZip / collectAttachmentBlobs）。
        rows = rows.map((r) => {
          const { blob: _blob, ...meta } = r as Attachment;
          return meta;
        });
      }
      tables[t.name] = rows;
    }
  });
  return {
    version: PAYLOAD_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
  };
}
// 証憑写真（C7）の実体バイナリを id → bytes で1件ずつ生成する。zip 同梱用。
// 主キーを先に取得してから1件ずつ get() することで、常に写真1枚分だけがメモリに乗る。
export async function* iterateAttachmentBlobs(): AsyncGenerator<readonly [string, Uint8Array]> {
  const ids = await db.attachments.toCollection().primaryKeys();
  for (const id of ids) {
    const row = await db.attachments.get(id);
    if (!row) {
      continue;
    }
    yield [id, new Uint8Array(await row.blob.arrayBuffer())];
  }
}
