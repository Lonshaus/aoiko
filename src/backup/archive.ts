import { strFromU8, strToU8, Unzip, UnzipInflate, Zip, ZipPassThrough } from 'fflate';
import type { UnzipFile } from 'fflate';
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
  attachmentBlobs: Map<string, Blob>;
}

function concatChunks(chunks: Uint8Array<ArrayBuffer>[]): Uint8Array {
  const total = chunks.reduce((n, chunk) => n + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
// zip を丸ごとメモリに展開せず、fflate の Unzip をエントリ単位のストリームとして消費する。
// 添付写真は1件分のバイト列だけが JS ヒープに乗り、完了した端から Blob 化してヒープを離れる。
// UnzipInflate を登録するのは、aoiko 自身は無圧縮（store）で書くが、他ツールで再圧縮された
// zip も読めるようにするため（保存側の圧縮方式に読み込み側を依存させない）。
export async function parseBackupZip(file: Blob): Promise<ParsedBackupZip> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (!looksLikeZip(head)) {
    throw new Error('zip として読み込めませんでした');
  }

  let payload: BackupPayload | undefined;
  let entryError: Error | undefined;
  const attachmentBlobs = new Map<string, Blob>();

  const unzipper = new Unzip();
  unzipper.register(UnzipInflate);
  unzipper.onfile = (entry: UnzipFile) => {
    const isPayload = entry.name === PAYLOAD_ENTRY_NAME;
    const isAttachment =
      entry.name.startsWith(ATTACHMENT_PREFIX) && entry.name.length > ATTACHMENT_PREFIX.length;
    if (!isPayload && !isAttachment) {
      return;
    }
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    entry.ondata = (err, chunk, final) => {
      if (err) {
        entryError = err instanceof Error ? err : new Error(String(err));
        return;
      }
      chunks.push(chunk);
      if (!final) {
        return;
      }
      if (isPayload) {
        try {
          payload = JSON.parse(strFromU8(concatChunks(chunks))) as BackupPayload;
        } catch {
          entryError = new Error(
            `zip 内の ${PAYLOAD_ENTRY_NAME} が JSON として読み込めませんでした`,
          );
        }
      } else {
        attachmentBlobs.set(entry.name.slice(ATTACHMENT_PREFIX.length), new Blob(chunks));
      }
    };
    entry.start();
  };

  try {
    const reader = file.stream().getReader();
    let current = await reader.read();
    while (!current.done) {
      const next = await reader.read();
      unzipper.push(current.value, next.done);
      if (entryError) {
        throw entryError;
      }
      current = next;
    }
  } catch (err) {
    if (err === entryError) {
      throw err;
    }
    throw new Error('zip として読み込めませんでした');
  }
  if (entryError) {
    throw entryError;
  }
  if (!payload) {
    throw new Error(`zip 内に ${PAYLOAD_ENTRY_NAME} が見つかりません`);
  }
  return { payload, attachmentBlobs };
}
