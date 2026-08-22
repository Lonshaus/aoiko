import {
  ATTACHMENT_DIR,
  SNAPSHOT_DIR,
  attachmentPath,
  buildSnapshot,
  expiredSnapshots,
  snapshotFileName,
  type SnapshotAttachmentRef,
} from './content-store';
import type { BackupAdapter, BackupPayload } from './types';
// 同期フォルダへ「散ファイル」で書き出す側。zip を作り直さず、変わった分だけ書く。
//
// まだ backup.svelte.ts からは呼んでいない。書き出しだけ先に切り替えると、
// 書けたものを読み戻す経路が無い状態（S6 未着手）になるため、切替は復元と同時に行う。

export interface AttachmentSource {
  id: string;
  sha256: string;
  bytes: number;
  data: Uint8Array;
}

export interface LooseBackupResult {
  snapshotPath: string;
  blobsWritten: number;
  blobsSkipped: number;
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
/**
 * blob を先に、スナップショットを最後に書く。
 *
 * 順序に意味があるのは「揃っている確率を上げる」ためだけで、正しさを担保しているのは
 * 内容定址そのもの。同期ツールが上げる順序は制御できないので、復元側は参照する blob が
 * 全て揃っているスナップショットを選ぶ（content-store.ts の missingBlobs）。
 *
 * 既に保存先にある blob は書き直さない。SHA-256 が同じなら中身も同じで、書き直しても
 * 同期の帯域を食うだけ。これが zip をやめて得られるもの。
 */
export async function writeLooseBackup(
  adapter: BackupAdapter,
  payload: BackupPayload,
  attachments: AsyncIterable<AttachmentSource>,
): Promise<LooseBackupResult> {
  const present = new Set(await adapter.list(ATTACHMENT_DIR));
  const refs: SnapshotAttachmentRef[] = [];
  let blobsWritten = 0;
  let blobsSkipped = 0;

  for await (const attachment of attachments) {
    // 参照は毎回積む。同じ写真を複数の仕訳へ貼っていれば ref は複数、実体は 1 つ。
    refs.push({ id: attachment.id, sha256: attachment.sha256, bytes: attachment.bytes });
    if (present.has(attachment.sha256)) {
      blobsSkipped++;
      continue;
    }
    await adapter.backup(streamOf(attachment.data), attachmentPath(attachment.sha256));
    // 同じ実体がこの 1 回の中で 2 度出てきても書くのは 1 度。
    present.add(attachment.sha256);
    blobsWritten++;
  }

  const snapshot = buildSnapshot(payload, refs);
  const snapshotPath = `${SNAPSHOT_DIR}/${snapshotFileName(payload.exportedAt)}`;
  await adapter.backup(streamOf(new TextEncoder().encode(JSON.stringify(snapshot))), snapshotPath);
  return { snapshotPath, blobsWritten, blobsSkipped };
}
/**
 * 古いスナップショットを消す。blob には触らない。
 *
 * 内容定址なので、消したスナップショットが参照していた blob も他が参照している限り
 * 生きている必要がある。参照されなくなった blob の削除は既定で行わない（決定 3）。
 */
export async function pruneSnapshots(
  adapter: BackupAdapter,
  retentionCount: number,
): Promise<string[]> {
  const expired = expiredSnapshots(await adapter.list(SNAPSHOT_DIR), retentionCount);
  for (const fileName of expired) {
    await adapter.remove(`${SNAPSHOT_DIR}/${fileName}`);
  }
  return expired;
}
