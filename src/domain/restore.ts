import { db } from '../db/db';
import { allowAllFiledYearWritesInThisTransaction } from '../db/filed-year-guard';
import { looksLikeZip, parseBackupZip, type BackupPayload } from '../backup';
import {
  BACKUP_PART_IDS,
  BACKUP_PART_SETTING_KEYS,
  BOOK_TABLES,
  FULL_PAYLOAD_VERSION,
  PARTIAL_PAYLOAD_VERSION,
  type BackupPartId,
} from '../backup/parts';
import { resolveBackupParts, validateBackupPayload } from './restore-validate';
import { safeAttachmentMimeType } from './restore-schema';
import { sha256Hex } from '../lib/sha256';
import type { Attachment } from '../db/types';
import { MAX_BACKUP_BYTES } from '../lib/file-limit';
import { m } from '../paraglide/messages';

export class IncompatibleBackupError extends Error {
  constructor(public readonly backupVersion: number) {
    super(
      `バックアップ形式バージョン ${backupVersion} には対応していません。対応している形式は ${FULL_PAYLOAD_VERSION} と ${PARTIAL_PAYLOAD_VERSION} です。`,
    );
    this.name = 'IncompatibleBackupError';
  }
}
export class BackupTooLargeError extends Error {
  constructor(
    public readonly fileSize: number,
    public readonly limit: number,
  ) {
    super(`バックアップファイルが大きすぎます（${fileSize} バイト、上限 ${limit} バイト）`);
    this.name = 'BackupTooLargeError';
  }
}
// zip は payload.json（帳簿データの本体）だけをメモリに載せて写真は Blob.slice のビューで
// 済ませるため写真枚数に関わらず軽い。旧 JSON 形式は file.text() でファイル全体を
// メモリに読むため、そちらだけサイズ上限を適用する。
export function isBackupTooLarge(isZip: boolean, size: number): boolean {
  return !isZip && size > MAX_BACKUP_BYTES;
}
// アップロードされたバックアップファイルを新旧自動判定してパースする。
// zip（帳簿データ + 証憑写真）と、旧形式の純 JSON（証憑写真は含まない）の両方を読める。
export async function parseBackupFile(file: File): Promise<{
  payload: BackupPayload;
  attachmentBlobs: Map<string, Blob>;
  corruptAttachmentNames: string[];
}> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZip = looksLikeZip(head);
  if (isBackupTooLarge(isZip, file.size)) {
    throw new BackupTooLargeError(file.size, MAX_BACKUP_BYTES);
  }
  if (isZip) {
    return parseBackupZip(file);
  }
  return {
    payload: parseBackupJson(await file.text()),
    attachmentBlobs: new Map(),
    corruptAttachmentNames: [],
  };
}
// 証憑のメタデータに実体の Blob を付ける。実体がある行は SHA-256 を中身から計算し直す。
// 実体の無い行はバックアップの値を残す。フォルダ復元で未ダウンロードだった写真は、次の
// フォルダバックアップがその名前の既存ファイルを使い回すため。
async function buildAttachmentRows(
  rows: unknown[],
  attachmentBlobs: Map<string, Blob>,
): Promise<{ rows: unknown[]; missingBlobCount: number }> {
  const out: unknown[] = [];
  let missingBlobCount = 0;
  for (const r of rows) {
    const meta = r as Omit<Attachment, 'blob'>;
    // Blob を作る前に比べる。制御文字を含む型は Blob が空文字へ変えてしまう。
    const mimeType = safeAttachmentMimeType(meta.mimeType);
    const blob = attachmentBlobs.get(meta.id);
    // メタデータはあるが実体が無い＝旧 JSON 形式や不完全な zip。空 Blob で復元し件数を記録。
    if (!blob) {
      missingBlobCount++;
      out.push({ ...meta, mimeType, blob: new Blob([], { type: mimeType }) });
      continue;
    }
    // Blob.slice は既存バイトのビューを返すだけでコピーしない。mimeType だけ張り替える。
    out.push({
      ...meta,
      mimeType,
      sha256: await sha256Hex(blob),
      blob: blob.slice(0, blob.size, mimeType),
    });
  }
  return { rows: out, missingBlobCount };
}
/**
 * 復元の前に、形式のバージョン・各行の型・含まれる区分を確かめる。同期処理で、データベースには
 * 触らない。返す copy は旧形式を直した複製で、復元はこれだけを読む。
 */
export function inspectBackupPayload(payload: BackupPayload): {
  copy: BackupPayload;
  parts: BackupPartId[];
} {
  if (payload.version !== FULL_PAYLOAD_VERSION && payload.version !== PARTIAL_PAYLOAD_VERSION) {
    throw new IncompatibleBackupError(payload.version);
  }
  const copy = validateBackupPayload(payload);
  return { copy, parts: resolveBackupParts(copy) };
}
// 呼出元の誤りなので、利用者向けの訳文にはしない。
function assertSelection(
  selected: ReadonlySet<BackupPartId>,
  available: ReadonlySet<string>,
): void {
  if (selected.size === 0) {
    throw new Error('復元する区分が選ばれていません');
  }
  for (const part of selected) {
    if (!available.has(part)) {
      throw new Error(
        `バックアップに含まれない区分は復元できません：${typeof part === 'string' ? part : typeof part}`,
      );
    }
  }
  if (selected.has('attachments') && !selected.has('books')) {
    throw new Error('証憑写真は帳簿データと一緒にしか復元できません');
  }
}
/**
 * 選んだ区分だけを、バックアップの内容で置き換える。選んだ区分のこの端末のデータは消える
 * ため、UI 側で必ず確認ダイアログを挟むこと。選ばなかった区分・端末専用の表と設定には
 * 触らない。例外として処理年度は、検証後のバックアップに無い（null や範囲外で捨てた場合を
 * 含む）ときはこの端末の値を残す。消すと起動時に起動時点の西暦年へ変わってしまうため。
 * attachmentBlobs が空の場合（旧形式 JSON 等）は証憑写真の実体を復元しない
 * （メタデータのみ残っていても blob は空になる）。
 */
export async function restoreFromPayload(
  payload: BackupPayload,
  attachmentBlobs: Map<string, Blob>,
  selected: ReadonlySet<BackupPartId>,
): Promise<{ tableCount: number; rowCount: number; missingBlobCount: number }> {
  // 消す前に検証する。不正なバックアップで既存データを失わないため。以降は検証済みの
  // 複製だけを読む。
  const { copy, parts } = inspectBackupPayload(payload);
  assertSelection(selected, new Set(parts));
  const tables = copy.tables;
  const books = selected.has('books');
  const withAttachments = selected.has('attachments');
  const settingRows = Object.hasOwn(tables, 'settings') ? tables.settings : undefined;
  const hasRestoredYear = (settingRows ?? []).some(
    (r) => (r as { key?: unknown }).key === 'currentYear',
  );
  const clearedSettingKeys = BACKUP_PART_IDS.filter((p) => selected.has(p))
    .flatMap((p) => BACKUP_PART_SETTING_KEYS[p])
    .filter((key) => key !== 'currentYear' || hasRestoredYear);
  const clearedSettingKeySet = new Set(clearedSettingKeys);
  const restoredSettings = (settingRows ?? []).filter((r) => {
    const key = (r as { key?: unknown }).key;
    return typeof key === 'string' && clearedSettingKeySet.has(key);
  });
  // Dexie トランザクション内では非 Dexie の Promise を待てないため、書き込むデータ
  // （証憑写真の Blob 組み立てを含む）はトランザクションの前に組み立てておく。
  const writes: { name: string; rows: unknown[] }[] = [];
  let missingBlobCount = 0;
  const tableNames = [...(books ? BOOK_TABLES : []), ...(withAttachments ? ['attachments'] : [])];
  for (const name of tableNames) {
    if (!Object.hasOwn(tables, name)) {
      continue;
    }
    let rows = tables[name];
    if (!Array.isArray(rows) || rows.length === 0) {
      continue;
    }
    if (name === 'attachments') {
      const built = await buildAttachmentRows(rows, attachmentBlobs);
      rows = built.rows;
      missingBlobCount = built.missingBlobCount;
    }
    writes.push({ name, rows });
  }
  if (restoredSettings.length > 0) {
    writes.push({ name: 'settings', rows: restoredSettings });
  }
  // 帳簿を置き換えて証憑は置き換えないとき、残す証憑は復元後の帳簿に仕訳があるものだけ。
  const keptEntryIds = new Set<string>();
  const entries = Object.hasOwn(tables, 'journalEntries') ? tables.journalEntries : undefined;
  for (const r of entries ?? []) {
    const id = (r as { id?: unknown }).id;
    if (typeof id === 'string') {
      keptEntryIds.add(id);
    }
  }
  // 消去と書き込みを 1 つのトランザクションに入れる。db.delete() でデータベースごと
  // 消してから書き込むと、書き込みが失敗してもロールバック先が「空の状態」になり、
  // 利用者の既存帳簿が復旧不能になる。clear() ならロールバックで元データが戻る。
  await db.transaction('rw', db.tables, async () => {
    // 復元は表の置換で、申告済み年度の仕訳もそのまま書き戻す。書き込みの門
    // （db/filed-year-guard.ts）はそれを止めるので、正当な経路であることを明示する。
    // ここを外すと、申告済みの年度を含むバックアップが復元できなくなる。
    allowAllFiledYearWritesInThisTransaction();
    for (const name of tableNames) {
      await db.table(name).clear();
    }
    if (clearedSettingKeys.length > 0) {
      await db.settings.bulkDelete(clearedSettingKeys);
    }
    for (const w of writes) {
      await db.table(w.name).bulkPut(w.rows);
    }
    if (books && !withAttachments) {
      if (keptEntryIds.size === 0) {
        await db.attachments.clear();
      } else {
        await db.attachments
          .where('entryId')
          .noneOf([...keptEntryIds])
          .delete();
      }
    }
  });

  const rowCount = writes.reduce((n, w) => n + w.rows.length, 0);
  return { tableCount: writes.length, rowCount, missingBlobCount };
}
// 旧形式（証憑写真を含まない純 JSON payload）専用の互換ラッパー。テスト専用で、
// バックアップが含む区分をすべて復元する（AI と外部送信の設定・API キーも入る）。
export async function restoreFromJson(
  payload: BackupPayload,
): Promise<{ tableCount: number; rowCount: number; missingBlobCount: number }> {
  return restoreFromPayload(payload, new Map(), new Set(inspectBackupPayload(payload).parts));
}
// JSON テキストをパース・検証する。形式不正時は例外を投げる。
export function parseBackupJson(text: string): BackupPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(m.error_backup_not_json());
  }
  if (!parsed || typeof parsed !== 'object' || !('version' in parsed) || !('tables' in parsed)) {
    throw new Error(m.error_backup_not_backup_format());
  }
  return parsed as BackupPayload;
}
