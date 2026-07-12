import { db } from '../db/db';
import {
  FILER_INFO_SETTING_KEYS,
  looksLikeZip,
  PAYLOAD_VERSION,
  parseBackupZip,
  type BackupPayload,
} from '../backup';
import { validateBackupPayload } from './restore-validate';
import type { Attachment } from '../db/types';

export class IncompatibleBackupError extends Error {
  constructor(public readonly backupVersion: number) {
    super(
      `バックアップ形式バージョン ${backupVersion} は現在の形式 ${PAYLOAD_VERSION} と互換性がありません`,
    );
    this.name = 'IncompatibleBackupError';
  }
}
// アップロードされたバックアップファイルを新旧自動判定してパースする（C7-4）。
// zip（帳簿データ + 証憑写真）と、旧形式の純 JSON（証憑写真は含まない）の両方を読める。
export async function parseBackupFile(
  file: File,
): Promise<{ payload: BackupPayload; attachmentBlobs: Map<string, Uint8Array> }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (looksLikeZip(bytes)) {
    return parseBackupZip(bytes);
  }
  const text = new TextDecoder('utf-8').decode(bytes);
  return { payload: parseBackupJson(text), attachmentBlobs: new Map() };
}
// バックアップの内容で IndexedDB を完全置換する。既存データはすべて削除されるため、
// UI 側で必ず確認ダイアログを挟むこと。attachmentBlobs が空の場合（旧形式 JSON 等）は
// 証憑写真の実体を復元しない（メタデータのみ残っていても blob は空になる）。
export async function restoreFromPayload(
  payload: BackupPayload,
  attachmentBlobs: Map<string, Uint8Array>,
): Promise<{ tableCount: number; rowCount: number; missingBlobCount: number }> {
  if (payload.version !== PAYLOAD_VERSION) {
    throw new IncompatibleBackupError(payload.version);
  }
  // 全消去の前に検証する。不正なバックアップで既存データを失わないため。
  validateBackupPayload(payload);
  // 申告者情報（個人情報）はバックアップに含まれないことがある（既定で除外）。
  // バックアップに含まれていない場合は全消去で失わないよう、現在値を退避して復帰する。
  const settingRows = payload.tables['settings'];
  const restoredSettingKeys = new Set(
    Array.isArray(settingRows) ? settingRows.map((r) => (r as { key?: string }).key) : [],
  );
  const preservedFilerSettings = (await db.settings.toArray()).filter(
    (r) => FILER_INFO_SETTING_KEYS.has(r.key) && !restoredSettingKeys.has(r.key),
  );
  // Dexie トランザクション内では非 Dexie の Promise を待てないため、書き込むデータ
  // （証憑写真の Blob 組み立てを含む）は全消去・トランザクションの前に組み立てておく。
  const writes: { name: string; rows: unknown[] }[] = [];
  let missingBlobCount = 0;
  for (const table of db.tables) {
    let rows = payload.tables[table.name];
    if (!Array.isArray(rows) || rows.length === 0) {
      continue;
    }
    if (table.name === 'attachments') {
      rows = rows.map((r) => {
        const meta = r as Omit<Attachment, 'blob'>;
        const bytes = attachmentBlobs.get(meta.id);
        // メタデータはあるが二進位が無い＝旧 JSON 形式や不完全な zip。空 Blob で復元し件数を記録。
        if (!bytes) {
          missingBlobCount++;
        }
        return { ...meta, blob: new Blob(bytes ? [bytes.slice()] : [], { type: meta.mimeType }) };
      });
    }
    writes.push({ name: table.name, rows });
  }

  await db.delete();
  await db.open();
  // 全消去後の書き込みは全か無かにする。1 行でも失敗したら全ロールバックし半書き込みを残さない。
  await db.transaction('rw', db.tables, async () => {
    for (const w of writes) {
      await db.table(w.name).bulkPut(w.rows);
    }
    if (preservedFilerSettings.length > 0) {
      await db.settings.bulkPut(preservedFilerSettings);
    }
  });

  const rowCount = writes.reduce((n, w) => n + w.rows.length, 0);
  return { tableCount: writes.length, rowCount, missingBlobCount };
}
// 旧形式（証憑写真を含まない純 JSON payload）専用の互換ラッパー。
export async function restoreFromJson(
  payload: BackupPayload,
): Promise<{ tableCount: number; rowCount: number; missingBlobCount: number }> {
  return restoreFromPayload(payload, new Map());
}
// JSON テキストをパース・検証する。形式不正時は throw。
export function parseBackupJson(text: string): BackupPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSON として読み込めませんでした');
  }
  if (!parsed || typeof parsed !== 'object' || !('version' in parsed) || !('tables' in parsed)) {
    throw new Error('バックアップ形式ではありません');
  }
  return parsed as BackupPayload;
}
