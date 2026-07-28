import { strFromU8, strToU8, unzip, Zip, ZipPassThrough } from 'fflate';
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
// fflate の Zip はコールバックを push した分だけ同期的に呼ぶストリーミング API。
// payload.json → 添付1件ずつ → zip.end() を pull() 1回につき1個ずつ ReadableStream
// へ流すことで、常に添付1件分だけがメモリに乗る。ReadableStream のデフォルト
// キューイング戦略が enqueue した分だけ desiredSize を下げるため、追加の
// キューやハンドシェイクを自前で組む必要はない。
//
// 以前は UI 凍結を避けるため処理を Worker へ逃がす非同期 API を使っていた。この Zip は
// 主スレッドで走るが、store なので実処理は memcpy と CRC32 だけで、しかも添付1件ごとに
// await が挟まる。全証憑を抱え込むことをやめる方が凍結対策として確実なので入れ替えた。
export function buildBackupZipStream(
  payload: BackupPayload,
  attachments: AsyncIterable<readonly [string, Uint8Array]>,
): ReadableStream<Uint8Array> {
  const iter = attachments[Symbol.asyncIterator]();
  let zip: Zip;
  let payloadSent = false;
  let iterDone = false;
  return new ReadableStream({
    start(controller) {
      zip = new Zip((err, chunk, final) => {
        if (err) {
          controller.error(err);
          return;
        }
        controller.enqueue(chunk);
        if (final) {
          controller.close();
        }
      });
    },
    async pull(controller) {
      if (!payloadSent) {
        payloadSent = true;
        const entry = new ZipPassThrough(PAYLOAD_ENTRY_NAME);
        zip.add(entry);
        entry.push(strToU8(JSON.stringify(payload)), true);
        return;
      }
      if (iterDone) {
        return;
      }
      let result: IteratorResult<readonly [string, Uint8Array]>;
      try {
        result = await iter.next();
      } catch (err) {
        zip.terminate();
        controller.error(err);
        return;
      }
      if (result.done) {
        iterDone = true;
        zip.end();
        return;
      }
      const [id, bytes] = result.value;
      const entry = new ZipPassThrough(`${ATTACHMENT_PREFIX}${id}`);
      zip.add(entry);
      entry.push(bytes, true);
    },
    cancel() {
      zip.terminate();
      void iter.return?.();
    },
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
