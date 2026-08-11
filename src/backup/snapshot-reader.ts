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

export interface FolderRestoreSource {
  payload: BackupPayload;
  attachmentBlobs: Map<string, Blob>;
  snapshotName: string;
  // 参照先が揃っていない・読めない等で飛ばした版の数。同期の途中なら普通に起きる。
  skippedSnapshots: number;
  // 実体を取り戻せなかった証憑の数。帳簿本体は復元できるので警告に留める。
  corruptAttachmentCount: number;
}
/**
 * 保存先フォルダから、そのまま復元できる一番新しいスナップショットを読む。
 *
 * 同期ツールがファイルを運ぶ順序は制御できないので、新しい版から順に見て、参照する
 * blob が全部揃っているものを選ぶ。1 つも無ければ null。
 */
export async function readLatestSnapshot(
  adapter: BackupAdapter,
): Promise<FolderRestoreSource | null> {
  const names = sortSnapshotsNewestFirst(await adapter.list(SNAPSHOT_DIR));
  if (names.length === 0) {
    return null;
  }
  const present = new Set(await adapter.list(ATTACHMENT_DIR));
  let skippedSnapshots = 0;
  for (const name of names) {
    const snapshot = await readSnapshot(adapter, name);
    if (snapshot === null || missingBlobs(snapshot, present).length > 0) {
      skippedSnapshots++;
      continue;
    }
    const { attachmentBlobs, corruptAttachmentCount } = await loadAttachments(adapter, snapshot);
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
    };
  }
  return null;
}

async function readSnapshot(adapter: BackupAdapter, name: string): Promise<Snapshot | null> {
  const bytes = await adapter.read(`${SNAPSHOT_DIR}/${name}`);
  return bytes === null ? null : parseSnapshot(new TextDecoder().decode(bytes));
}
/**
 * 復元側が要るのは証憑 id → 実体の対応で、保存先にあるのは SHA-256 の名前の実体。
 * 同じ写真を複数の仕訳へ貼っていれば実体は 1 つで参照が複数になるため、読むのは
 * 1 回だけにして id ごとに同じ Blob を配る。
 */
async function loadAttachments(
  adapter: BackupAdapter,
  snapshot: Snapshot,
): Promise<{ attachmentBlobs: Map<string, Blob>; corruptAttachmentCount: number }> {
  // null は「読めなかった／中身が名前と合わない」。同じ実体を読み直さないよう失敗も覚える。
  const byHash = new Map<string, Blob | null>();
  const attachmentBlobs = new Map<string, Blob>();
  let corruptAttachmentCount = 0;
  for (const ref of snapshot.attachments) {
    if (!byHash.has(ref.sha256)) {
      byHash.set(ref.sha256, await readVerifiedBlob(adapter, ref.sha256));
    }
    const blob = byHash.get(ref.sha256) ?? null;
    if (blob === null) {
      corruptAttachmentCount++;
      continue;
    }
    attachmentBlobs.set(ref.id, blob);
  }
  return { attachmentBlobs, corruptAttachmentCount };
}
/**
 * 内容定址が効くのはここ。名前が中身の SHA-256 なので、同期が途中で切れた半端な
 * ファイルを中身から見分けられる。合わなければその写真 1 枚を諦め、帳簿は復元する。
 */
async function readVerifiedBlob(adapter: BackupAdapter, sha256: string): Promise<Blob | null> {
  const data = await adapter.read(attachmentPath(sha256));
  if (data === null || (await sha256Hex(data)) !== sha256) {
    return null;
  }
  return new Blob([data]);
}
