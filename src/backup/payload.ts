import { db } from '../db/db';
import { sha256Hex } from '../lib/sha256';
import type { Attachment } from '../db/types';
import type { BackupPayload } from './types';
import {
  BACKUP_PART_SETTING_KEYS,
  BACKUP_PART_TABLES,
  EXPORT_DEFAULT_PARTS,
  FILER_INFO_SETTING_KEYS,
  SENSITIVE_SETTING_KEYS,
  SKIP_SETTING_KEYS,
  payloadVersionForParts,
  sortBackupParts,
  type BackupPartId,
} from './parts';
// 一覧の中身と除外の理由は parts.ts にまとめてある。
export { FILER_INFO_SETTING_KEYS, SENSITIVE_SETTING_KEYS, SKIP_SETTING_KEYS };

export const PAYLOAD_VERSION = 1;

interface BuildPayloadOptions {
  // 含める区分。省略時は EXPORT_DEFAULT_PARTS（API キーと申告者情報を含めない）。
  parts?: ReadonlySet<BackupPartId>;
}

export async function buildPayload(options: BuildPayloadOptions = {}): Promise<BackupPayload> {
  const requested = new Set(options.parts ?? EXPORT_DEFAULT_PARTS);
  // 証憑だけのファイルは復元側が受け付けないので、帳簿データが無ければ証憑も外す。
  if (!requested.has('books')) {
    requested.delete('attachments');
  }
  const parts = sortBackupParts(requested);
  const tableNames = new Set(['settings', ...parts.flatMap((p) => BACKUP_PART_TABLES[p])]);
  // 端末専用のキーと、どの区分にも属さない旧キーは書き出さない。
  const settingKeys = new Set(parts.flatMap((p) => BACKUP_PART_SETTING_KEYS[p]));
  const tables: Record<string, unknown[]> = {};
  // 全テーブルを1つの読み取りトランザクションで揃える。table ごとに await t.toArray()
  // すると Dexie がその都度独立トランザクションを開き、間に書き込みが割り込んで
  // 参照整合性が壊れたスナップショットになる（#316）。写真バイナリの読み出しは
  // iterateAttachmentBlobs で zip ストリーミング中に別途行うため、ここには含めない。
  await db.transaction('r', db.tables, async () => {
    for (const t of db.tables) {
      if (!tableNames.has(t.name)) {
        continue;
      }
      let rows = await t.toArray();
      if (t.name === 'settings') {
        rows = rows.filter((r) => settingKeys.has((r as { key: string }).key));
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
    version: payloadVersionForParts(new Set(parts)),
    exportedAt: new Date().toISOString(),
    parts,
    tables,
  };
}
// 証憑写真の実体バイナリを id → bytes で1件ずつ生成する。zip 同梱用。
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
// コンテンツアドレス方式バックアップ用。id・SHA-256・大きさ・実体を 1 件ずつ生成する。
// zip 同梱用の iterateAttachmentBlobs と分けてあるのは、あちらが id をファイル名に使う
// のに対し、こちらは SHA-256 をファイル名に使うため（同じ写真は 1 つしか置かない）。
//
// sha256 は v10 の upgrade で全行に入るが、型の上では任意のままなので、欠けていれば
// その場で計算する。ここで諦めると、その写真だけが復元できないバックアップになる。
export async function* iterateAttachmentSources(): AsyncGenerator<{
  id: string;
  sha256: string;
  bytes: number;
  data: Uint8Array;
}> {
  const ids = await db.attachments.toCollection().primaryKeys();
  for (const id of ids) {
    const row = await db.attachments.get(id);
    if (!row) {
      continue;
    }
    const data = new Uint8Array(await row.blob.arrayBuffer());
    yield {
      id,
      sha256: row.sha256 ?? (await sha256Hex(row.blob)),
      bytes: data.byteLength,
      data,
    };
  }
}
