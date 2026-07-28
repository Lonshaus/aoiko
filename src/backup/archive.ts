import { strFromU8, strToU8, unzip, zip } from 'fflate';
import type { BackupPayload } from './types';

const PAYLOAD_ENTRY_NAME = 'payload.json';
const ATTACHMENT_PREFIX = 'attachments/';
// zip 先頭マジックナンバー（PK\x03\x04 または PK\x05\x06 = 空 zip）。新旧バックアップ形式の自動判定に使う。
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}
// 証憑写真（C7）は base64 化すると容量が約1.4倍に膨らむため、JSON に埋め込まず
// zip 内に原始バイナリのまま同梱する。画像は既に圧縮済みなので zip 自体は無圧縮（store）にする。
//
// fflate の非同期 API は処理を Worker へ逃がす。同期版だと証憑写真を全部抱えた
// zip 生成・解凍の間 UI が固まり、写真が数百枚ある利用者ほど深刻になる。
// Worker は blob URL から生成されるが、CSP の worker-src / script-src が blob: を
// 許可しており、tesseract.js と違って外部スクリプトを importScripts しないため通る。
export function buildBackupZip(
  payload: BackupPayload,
  attachmentBlobs: Map<string, Uint8Array>,
): Promise<Uint8Array<ArrayBuffer>> {
  const files: Record<string, Uint8Array> = {
    [PAYLOAD_ENTRY_NAME]: strToU8(JSON.stringify(payload)),
  };
  for (const [id, bytes] of attachmentBlobs) {
    files[`${ATTACHMENT_PREFIX}${id}`] = bytes;
  }
  return new Promise((resolve, reject) => {
    zip(files, { level: 0 }, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(data);
    });
  });
}

export interface ParsedBackupZip {
  payload: BackupPayload;
  attachmentBlobs: Map<string, Uint8Array>;
}

export async function parseBackupZip(bytes: Uint8Array): Promise<ParsedBackupZip> {
  let files: Record<string, Uint8Array>;
  try {
    files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
      unzip(bytes, (err, data) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(data);
      });
    });
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
