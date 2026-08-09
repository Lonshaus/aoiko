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

export function unreferencedBlobs(
  present: ReadonlySet<string>,
  referenced: ReadonlySet<string>,
): string[] {
  return [...present].filter((sha256) => !referenced.has(sha256));
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function blobsToDelete(
  candidates: readonly { sha256: string; unreferencedSinceMs: number }[],
  nowMs: number,
  retentionDays: number | null,
): string[] {
  if (retentionDays === null || !Number.isFinite(retentionDays) || retentionDays < 0) {
    return [];
  }
  const thresholdMs = retentionDays * DAY_MS;
  return candidates
    .filter((c) => nowMs - c.unreferencedSinceMs >= thresholdMs)
    .map((c) => c.sha256);
}
