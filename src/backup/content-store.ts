import type { BackupPayload } from './types';

export const SNAPSHOT_DIR = 'snapshots';
export const ATTACHMENT_DIR = 'attachments';
export const SNAPSHOT_FORMAT = 1;

export interface SnapshotAttachmentRef {
  id: string;
  sha256: string;
  bytes: number;
}

export interface Snapshot {
  format: number;
  // 中身（tables）の版。format は入れ物の版で、別々に動く。これを落とすと復元時に
  // BackupPayload の版を検査できず、IncompatibleBackupError の防壁が効かなくなる。
  payloadVersion: number;
  exportedAt: string;
  tables: Record<string, unknown[]>;
  attachments: SnapshotAttachmentRef[];
}

export function buildSnapshot(
  payload: BackupPayload,
  attachments: readonly SnapshotAttachmentRef[],
): Snapshot {
  return {
    format: SNAPSHOT_FORMAT,
    payloadVersion: payload.version,
    exportedAt: payload.exportedAt,
    tables: payload.tables,
    attachments: [...attachments],
  };
}

const SNAPSHOT_FILE_NAME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{6}Z\.json$/;

export function snapshotFileName(exportedAt: string): string {
  const ms = Date.parse(exportedAt);
  if (Number.isNaN(ms)) {
    throw new RangeError(`invalid ISO instant: ${exportedAt}`);
  }
  // 固定長にすることで辞書順ソートがそのまま時系列順になる。日付部分のハイフンは残す。
  const compact = new Date(ms).toISOString().replace(/(\d{2}):(\d{2}):(\d{2})\.\d{3}Z$/, '$1$2$3Z');
  return `${compact}.json`;
}

export function sortSnapshotsNewestFirst(fileNames: readonly string[]): string[] {
  return fileNames
    .filter((name) => SNAPSHOT_FILE_NAME_PATTERN.test(name))
    .slice()
    .sort()
    .reverse();
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function isValidAttachmentRef(v: unknown): v is SnapshotAttachmentRef {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.sha256 === 'string' &&
    SHA256_PATTERN.test(r.sha256) &&
    typeof r.bytes === 'number'
  );
}

export function parseSnapshot(text: string): Snapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.format !== SNAPSHOT_FORMAT) {
    return null;
  }
  if (typeof obj.payloadVersion !== 'number' || !Number.isInteger(obj.payloadVersion)) {
    return null;
  }
  if (typeof obj.exportedAt !== 'string') {
    return null;
  }
  if (typeof obj.tables !== 'object' || obj.tables === null || Array.isArray(obj.tables)) {
    return null;
  }
  if (!Array.isArray(obj.attachments) || !obj.attachments.every(isValidAttachmentRef)) {
    return null;
  }
  return {
    format: obj.format,
    payloadVersion: obj.payloadVersion,
    exportedAt: obj.exportedAt,
    tables: obj.tables as Record<string, unknown[]>,
    attachments: obj.attachments,
  };
}

export function missingBlobs(snapshot: Snapshot, present: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const ref of snapshot.attachments) {
    if (present.has(ref.sha256) || seen.has(ref.sha256)) {
      continue;
    }
    seen.add(ref.sha256);
    result.push(ref.sha256);
  }
  return result;
}
// バックスラッシュ・NUL を含む制御文字・Windows のドライブ修飾（`C:`）を拒む。
const INVALID_SEGMENT_PATTERN = /[\\\u0000-\u001F]|^[A-Za-z]:/;
// 保存先ルートからの相対パスをセグメントへ分解する。ここは信頼境界で、同期フォルダから
// 読んだファイル名がそのままパスへ合成される。壊れた名前・細工された名前で保存先の外を
// 指せてはならないため、正規化して通すのではなく必ず拒否する（黙って直すと検証が無意味）。
export function splitBackupPath(path: string): string[] {
  const segments = path.split('/');
  for (const segment of segments) {
    // 空セグメントで、空文字・先頭/末尾スラッシュ・連続スラッシュをまとめて弾く
    if (
      segment === '' ||
      segment === '.' ||
      segment === '..' ||
      INVALID_SEGMENT_PATTERN.test(segment)
    ) {
      throw new RangeError(`invalid backup path: ${JSON.stringify(path)}`);
    }
  }
  return segments;
}

export function attachmentPath(sha256: string): string {
  if (!SHA256_PATTERN.test(sha256)) {
    throw new RangeError(`invalid sha256: ${sha256}`);
  }
  return `${ATTACHMENT_DIR}/${sha256}`;
}

export function expiredSnapshots(fileNames: readonly string[], retentionCount: number): string[] {
  if (retentionCount <= 0) {
    return [];
  }
  const sorted = sortSnapshotsNewestFirst(fileNames);
  return sorted.slice(retentionCount);
}

export function isBlobFileName(name: string): boolean {
  return SHA256_PATTERN.test(name);
}
// 保存先に置かれているが、どのスナップショットからも参照されていない実体。
// SHA-256 の名前でないものは aoiko が置いたものではないので、対象から外す。
export function unreferencedBlobs(
  present: ReadonlySet<string>,
  referenced: ReadonlySet<string>,
): string[] {
  return [...present].filter((name) => isBlobFileName(name) && !referenced.has(name));
}

const DAY_MS = 24 * 60 * 60 * 1000;
// ファイル名は exportedAt から作られているので、中身を読まずに時刻が取れる。
export function snapshotTimeMs(fileName: string): number | null {
  if (!SNAPSHOT_FILE_NAME_PATTERN.test(fileName)) {
    return null;
  }
  const ms = Date.parse(
    `${fileName.slice(0, 13)}:${fileName.slice(13, 15)}:${fileName.slice(15, 17)}Z`,
  );
  return Number.isNaN(ms) ? null : ms;
}
/**
 * 実体の掃除で「参照されている」を数えるために読むべきスナップショット。
 *
 * retentionDays 以内の版だけ読めば足りる。その範囲のどれからも参照されていない
 * 実体は、少なくとも retentionDays のあいだ参照されていないことになるため。
 * 判定に「いつ参照されなくなったか」の記録は要らず、フォルダに状態ファイルを
 * 増やさずに済む。
 *
 * 最新版だけは年齢に関わらず必ず含める。復元に使われるのはその版なので、参照先を
 * 消してしまうと直近のバックアップが写真の欠けたものになる。
 */
export function snapshotsToScanForSweep(
  fileNames: readonly string[],
  nowMs: number,
  retentionDays: number,
): string[] {
  const sorted = sortSnapshotsNewestFirst(fileNames);
  if (sorted.length === 0 || retentionDays <= 0) {
    return [];
  }
  const cutoff = nowMs - retentionDays * DAY_MS;
  return sorted.filter((name, i) => i === 0 || (snapshotTimeMs(name) ?? 0) >= cutoff);
}
