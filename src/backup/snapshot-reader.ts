import { DeadlineExceededError, withDeadline } from '../lib/deadline';
import { sha256Hex } from '../lib/sha256';
import {
  ATTACHMENT_DIR,
  SNAPSHOT_DIR,
  attachmentPath,
  missingBlobs,
  parseSnapshot,
  sortSnapshotsNewestFirst,
  type Snapshot,
} from './content-store';
import type { BackupAdapter, BackupPayload } from './types';

const DEFAULT_READ_DEADLINE_MS = 30_000;

export interface FolderRestoreOptions {
  readDeadlineMs?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface FolderRestoreSource {
  payload: BackupPayload;
  attachmentBlobs: Map<string, Blob>;
  snapshotName: string;
  // 参照先が揃っていない・読めない等で飛ばした版の数。同期の途中なら普通に起きる。
  skippedSnapshots: number;
  // 実体を取り戻せなかった証憑の数。帳簿本体は復元できるので警告に留める。
  corruptAttachmentCount: number;
  // 時限内に読み切れなかった証憑の数。クラウド側にまだ実体があるだけで壊れてはいない。
  notDownloadedCount: number;
}
/**
 * 保存先フォルダから、そのまま復元できる一番新しいスナップショットを読む。
 *
 * 同期ツールがファイルを運ぶ順序は制御できないので、新しい版から順に見て、参照する
 * blob が全部揃っているものを選ぶ。1 つも無ければ null。
 */
export async function readLatestSnapshot(
  adapter: BackupAdapter,
  options?: FolderRestoreOptions,
): Promise<FolderRestoreSource | null> {
  const readDeadlineMs = options?.readDeadlineMs ?? DEFAULT_READ_DEADLINE_MS;
  const names = sortSnapshotsNewestFirst(await adapter.list(SNAPSHOT_DIR));
  if (names.length === 0) {
    return null;
  }
  const present = new Set(await adapter.list(ATTACHMENT_DIR));
  let skippedSnapshots = 0;
  for (const name of names) {
    const snapshot = await readSnapshot(adapter, name, readDeadlineMs);
    if (snapshot === null || missingBlobs(snapshot, present).length > 0) {
      skippedSnapshots++;
      continue;
    }
    const { attachmentBlobs, corruptAttachmentCount, notDownloadedCount } = await loadAttachments(
      adapter,
      snapshot,
      readDeadlineMs,
      options?.onProgress,
    );
    return {
      payload: {
        version: snapshot.payloadVersion,
        exportedAt: snapshot.exportedAt,
        tables: snapshot.tables,
      },
      attachmentBlobs,
      snapshotName: name,
      skippedSnapshots,
      corruptAttachmentCount,
      notDownloadedCount,
    };
  }
  return null;
}

async function readSnapshot(
  adapter: BackupAdapter,
  name: string,
  readDeadlineMs: number,
): Promise<Snapshot | null> {
  let bytes: Uint8Array<ArrayBuffer> | null;
  try {
    bytes = await withDeadline(adapter.read(`${SNAPSHOT_DIR}/${name}`), readDeadlineMs);
  } catch (error) {
    if (error instanceof DeadlineExceededError) {
      return null;
    }
    throw error;
  }
  return bytes === null ? null : parseSnapshot(new TextDecoder().decode(bytes));
}

type BlobRead = { kind: 'ok'; blob: Blob } | { kind: 'corrupt' } | { kind: 'timeout' };
/**
 * 復元側が要るのは証憑 id → 実体の対応で、保存先にあるのは SHA-256 の名前の実体。
 * 同じ写真を複数の仕訳へ貼っていれば実体は 1 つで参照が複数になるため、読むのは
 * 1 回だけにして id ごとに同じ結果を配る。
 */
async function loadAttachments(
  adapter: BackupAdapter,
  snapshot: Snapshot,
  readDeadlineMs: number,
  onProgress: ((done: number, total: number) => void) | undefined,
): Promise<{
  attachmentBlobs: Map<string, Blob>;
  corruptAttachmentCount: number;
  notDownloadedCount: number;
}> {
  const byHash = new Map<string, BlobRead>();
  const attachmentBlobs = new Map<string, Blob>();
  let corruptAttachmentCount = 0;
  let notDownloadedCount = 0;
  const total = snapshot.attachments.length;
  let done = 0;
  for (const ref of snapshot.attachments) {
    let result = byHash.get(ref.sha256);
    if (result === undefined) {
      result = await readVerifiedBlob(adapter, ref.sha256, readDeadlineMs);
      byHash.set(ref.sha256, result);
    }
    if (result.kind === 'ok') {
      attachmentBlobs.set(ref.id, result.blob);
    } else if (result.kind === 'timeout') {
      notDownloadedCount++;
    } else {
      corruptAttachmentCount++;
    }
    done++;
    onProgress?.(done, total);
  }
  return { attachmentBlobs, corruptAttachmentCount, notDownloadedCount };
}
/**
 * 内容定址が効くのはここ。名前が中身の SHA-256 なので、同期が途中で切れた半端な
 * ファイルを中身から見分けられる。合わなければその写真 1 枚を諦め、帳簿は復元する。
 * 時限切れは「壊れている」とは別に扱う。クラウド側にまだ実体があるだけで、回線が
 * 戻れば読めるようになる。
 */
async function readVerifiedBlob(
  adapter: BackupAdapter,
  sha256: string,
  readDeadlineMs: number,
): Promise<BlobRead> {
  let data: Uint8Array<ArrayBuffer> | null;
  try {
    data = await withDeadline(adapter.read(attachmentPath(sha256)), readDeadlineMs);
  } catch (error) {
    if (error instanceof DeadlineExceededError) {
      return { kind: 'timeout' };
    }
    throw error;
  }
  if (data === null || (await sha256Hex(data)) !== sha256) {
    return { kind: 'corrupt' };
  }
  return { kind: 'ok', blob: new Blob([data]) };
}
