import {
  ATTACHMENT_DIR,
  SNAPSHOT_DIR,
  attachmentPath,
  parseSnapshot,
  snapshotsToScanForSweep,
  unreferencedBlobs,
} from './content-store';
import type { BackupAdapter } from './types';
/**
 * どのスナップショットからも参照されなくなった証憑の実体を消す。
 *
 * 既定では呼ばれない（設定で日数を指定した場合のみ）。内容定址なので同じ写真は 1 つしか
 * 無く、増えるのは帳簿から消した証憑の分だけ。放置しても膨らみ方は緩いので、既定は
 * 「消さない」に倒してある。
 *
 * 日数を挟むのは複数端末のため。同じ同期フォルダを 2 台が見ていると、片方から見えて
 * いないスナップショットが参照している実体が「誰も要らない」に見える。日数はその窓を
 * 狭めるだけで、消えないことを保証はしない。
 */
export async function sweepUnreferencedBlobs(
  adapter: BackupAdapter,
  retentionDays: number,
  nowMs: number,
): Promise<string[]> {
  const scan = snapshotsToScanForSweep(await adapter.list(SNAPSHOT_DIR), nowMs, retentionDays);
  if (scan.length === 0) {
    return [];
  }
  const referenced = new Set<string>();
  for (const name of scan) {
    const bytes = await adapter.read(`${SNAPSHOT_DIR}/${name}`);
    const snapshot = bytes === null ? null : parseSnapshot(new TextDecoder().decode(bytes));
    // 1 つでも読めない版があれば何も消さない。その版が参照していた実体を巻き添えにする。
    // 同期が途中・端末外の版がまだ届いていない、はどちらも普通に起きる。
    if (snapshot === null) {
      return [];
    }
    for (const ref of snapshot.attachments) {
      referenced.add(ref.sha256);
    }
  }
  const doomed = unreferencedBlobs(new Set(await adapter.list(ATTACHMENT_DIR)), referenced);
  for (const sha256 of doomed) {
    await adapter.remove(attachmentPath(sha256));
  }
  return doomed;
}
