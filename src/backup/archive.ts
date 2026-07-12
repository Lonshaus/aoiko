import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { BackupPayload } from './types';

const PAYLOAD_ENTRY_NAME = 'payload.json';
const ATTACHMENT_PREFIX = 'attachments/';
// zip 先頭マジックナンバー（PK\x03\x04 または PK\x05\x06 = 空 zip）。新旧バックアップ形式の自動判定に使う。
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}
// 証憑写真（C7）は base64 化すると容量が約1.4倍に膨らむため、JSON に埋め込まず
// zip 内に原始バイナリのまま同梱する。画像は既に圧縮済みなので zip 自体は無圧縮（store）にする。
export function buildBackupZip(
  payload: BackupPayload,
  attachmentBlobs: Map<string, Uint8Array>,
): Uint8Array {
  const files: Record<string, Uint8Array> = {
    [PAYLOAD_ENTRY_NAME]: strToU8(JSON.stringify(payload)),
  };
  for (const [id, bytes] of attachmentBlobs) {
    files[`${ATTACHMENT_PREFIX}${id}`] = bytes;
  }
  return zipSync(files, { level: 0 });
}

export interface ParsedBackupZip {
  payload: BackupPayload;
  attachmentBlobs: Map<string, Uint8Array>;
}

export function parseBackupZip(bytes: Uint8Array): ParsedBackupZip {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('zip として読み込めませんでした');
  }
  const payloadFile = files[PAYLOAD_ENTRY_NAME];
  if (!payloadFile) {
    throw new Error(`zip 内に ${PAYLOAD_ENTRY_NAME} が見つかりません`);
  }
  let payload: BackupPayload;
  try {
    payload = JSON.parse(strFromU8(payloadFile)) as BackupPayload;
  } catch {
    throw new Error(`zip 内の ${PAYLOAD_ENTRY_NAME} が JSON として読み込めませんでした`);
  }
  const attachmentBlobs = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(files)) {
    if (path.startsWith(ATTACHMENT_PREFIX) && path.length > ATTACHMENT_PREFIX.length) {
      attachmentBlobs.set(path.slice(ATTACHMENT_PREFIX.length), data);
    }
  }
  return { payload, attachmentBlobs };
}
