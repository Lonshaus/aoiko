import { inflateSync } from 'fflate';
import { createCrc32, crc32 } from './crc32';
import { ZipStoreWriter } from './zip-writer';
import type { BackupPayload } from './types';

const PAYLOAD_ENTRY_NAME = 'payload.json';
const ATTACHMENT_PREFIX = 'attachments/';
// zip 先頭マジックナンバー（PK\x03\x04 または PK\x05\x06 = 空 zip）。新旧バックアップ形式の自動判定に使う。
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}
// 証憑写真は base64 化すると約1.4倍に膨らむので JSON へ埋めず、原始バイナリのまま zip に
// 同梱する。画像は圧縮済みなので zip 自体は無圧縮（store）。
//
// pull() 1 回につき 1 エントリだけ流すので、常に添付 1 件分しかメモリに乗らない。
// ReadableStream の既定のキューイング戦略が背圧を見てくれるため、自前のキューは要らない。
export function buildBackupZipStream(
  payload: BackupPayload,
  attachments: AsyncIterable<readonly [string, Uint8Array]>,
): ReadableStream<Uint8Array> {
  const iter = attachments[Symbol.asyncIterator]();
  const writer = new ZipStoreWriter(new Date());
  let payloadSent = false;
  return new ReadableStream({
    async pull(controller) {
      if (!payloadSent) {
        payloadSent = true;
        const bytes = new TextEncoder().encode(JSON.stringify(payload));
        for (const chunk of writer.addEntry(PAYLOAD_ENTRY_NAME, bytes)) {
          controller.enqueue(chunk);
        }
        return;
      }
      let result: IteratorResult<readonly [string, Uint8Array]>;
      try {
        result = await iter.next();
      } catch (err) {
        controller.error(err);
        return;
      }
      if (result.done) {
        controller.enqueue(writer.finish());
        controller.close();
        return;
      }
      const [id, bytes] = result.value;
      for (const chunk of writer.addEntry(`${ATTACHMENT_PREFIX}${id}`, bytes)) {
        controller.enqueue(chunk);
      }
    },
    cancel() {
      void iter.return?.();
    },
  });
}

export interface ParsedBackupZip {
  payload: BackupPayload;
  attachmentBlobs: Map<string, Blob>;
  // CRC32 が壊れていた添付ファイル名。payload.json 自体が壊れている場合は
  // BackupCorruptError を投げるため、ここに payload は含まれない。
  corruptAttachmentNames: string[];
}

const ZIP_READ_ERROR = 'zip として読み込めませんでした';
const EOCD_SIGNATURE = 0x06054b50;
const EOCD_MIN_SIZE = 22;
const EOCD_MAX_COMMENT_SIZE = 65535;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_LOCATOR_SIZE = 20;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_EOCD_FIXED_SIZE = 56;
const ZIP64_EXTRA_ID = 0x0001;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const CENTRAL_DIRECTORY_FIXED_SIZE = 46;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_FILE_HEADER_FIXED_SIZE = 30;
const SENTINEL_16 = 0xffff;
const SENTINEL_32 = 0xffffffff;
// 1回の読みで JS ヒープに載る上限。無圧縮の添付はこの単位で読み捨てながら CRC を回す。
const VERIFY_CHUNK_SIZE = 1024 * 1024;

export class BackupCorruptError extends Error {
  constructor(public readonly entryNames: string[]) {
    super(
      `バックアップファイルが壊れています（${entryNames.length} 件のデータが検証に失敗しました）`,
    );
    this.name = 'BackupCorruptError';
  }
}

interface CentralDirectoryRecord {
  name: string;
  method: number;
  compressedSize: number;
  crc32: number;
  localHeaderOffset: number;
}
// EOCD（末尾の目録）は末尾から最大 65557 バイト以内にある（コメント長の上限が 65535）。
// そこだけ読めば全体を読まずに目録の位置が分かる。
async function findEocd(
  file: Blob,
): Promise<{ tail: Uint8Array; tailStart: number; offsetInTail: number }> {
  const searchSize = Math.min(file.size, EOCD_MIN_SIZE + EOCD_MAX_COMMENT_SIZE);
  const tailStart = file.size - searchSize;
  const tail = new Uint8Array(await file.slice(tailStart, file.size).arrayBuffer());
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  for (let i = tail.length - EOCD_MIN_SIZE; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      return { tail, tailStart, offsetInTail: i };
    }
  }
  throw new Error(ZIP_READ_ERROR);
}

function readSafeUint64(view: DataView, pos: number): number {
  if (pos + 8 > view.byteLength) {
    throw new Error(ZIP_READ_ERROR);
  }
  const value = view.getBigUint64(pos, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(ZIP_READ_ERROR);
  }
  return Number(value);
}
// 65536 件以上のエントリや 4GiB 超の目録・添付は zip64 の拡張レコードに真の値が入る。
// ZIP64 EOCD ロケータ→ ZIP64 EOCD 本体とたどって取り直す。
async function readZip64Eocd(
  file: Blob,
  eocdAbsOffset: number,
): Promise<{ recordCount: number; cdSize: number; cdOffset: number }> {
  const locatorOffset = eocdAbsOffset - ZIP64_EOCD_LOCATOR_SIZE;
  if (locatorOffset < 0) {
    throw new Error(ZIP_READ_ERROR);
  }
  const locatorBytes = new Uint8Array(
    await file.slice(locatorOffset, locatorOffset + ZIP64_EOCD_LOCATOR_SIZE).arrayBuffer(),
  );
  const locatorView = new DataView(
    locatorBytes.buffer,
    locatorBytes.byteOffset,
    locatorBytes.byteLength,
  );
  if (
    locatorBytes.length < ZIP64_EOCD_LOCATOR_SIZE ||
    locatorView.getUint32(0, true) !== ZIP64_EOCD_LOCATOR_SIGNATURE
  ) {
    throw new Error(ZIP_READ_ERROR);
  }
  const zip64EocdOffset = readSafeUint64(locatorView, 8);
  const zip64Bytes = new Uint8Array(
    await file.slice(zip64EocdOffset, zip64EocdOffset + ZIP64_EOCD_FIXED_SIZE).arrayBuffer(),
  );
  const zip64View = new DataView(zip64Bytes.buffer, zip64Bytes.byteOffset, zip64Bytes.byteLength);
  if (
    zip64Bytes.length < ZIP64_EOCD_FIXED_SIZE ||
    zip64View.getUint32(0, true) !== ZIP64_EOCD_SIGNATURE
  ) {
    throw new Error(ZIP_READ_ERROR);
  }
  return {
    recordCount: readSafeUint64(zip64View, 32),
    cdSize: readSafeUint64(zip64View, 40),
    cdOffset: readSafeUint64(zip64View, 48),
  };
}

async function readCentralDirectoryLocation(
  file: Blob,
): Promise<{ cdOffset: number; cdSize: number; recordCount: number }> {
  const { tail, tailStart, offsetInTail } = await findEocd(file);
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  const recordCount = view.getUint16(offsetInTail + 10, true);
  const cdSize = view.getUint32(offsetInTail + 12, true);
  const cdOffset = view.getUint32(offsetInTail + 16, true);
  const needsZip64 =
    recordCount === SENTINEL_16 || cdSize === SENTINEL_32 || cdOffset === SENTINEL_32;
  if (!needsZip64) {
    return { cdOffset, cdSize, recordCount };
  }
  return readZip64Eocd(file, tailStart + offsetInTail);
}

function findZip64ExtraField(extra: Uint8Array): Uint8Array | undefined {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let pos = 0;
  while (pos + 4 <= extra.length) {
    const id = view.getUint16(pos, true);
    const size = view.getUint16(pos + 2, true);
    if (pos + 4 + size > extra.length) {
      break;
    }
    if (id === ZIP64_EXTRA_ID) {
      return extra.subarray(pos + 4, pos + 4 + size);
    }
    pos += 4 + size;
  }
  return undefined;
}
// zip64 拡張フィールドの並び順は spec 上固定：元の値が sentinel だったフィールドだけが
// 「非圧縮サイズ→圧縮サイズ→ローカルヘッダオフセット→ディスク開始番号」の順で現れる。
function resolveZip64Sizes(
  extra: Uint8Array,
  compressedSize: number,
  uncompressedSize: number,
  localHeaderOffset: number,
): { compressedSize: number; localHeaderOffset: number } {
  const needsZip64 =
    compressedSize === SENTINEL_32 ||
    uncompressedSize === SENTINEL_32 ||
    localHeaderOffset === SENTINEL_32;
  if (!needsZip64) {
    return { compressedSize, localHeaderOffset };
  }
  const field = findZip64ExtraField(extra);
  if (!field) {
    throw new Error(ZIP_READ_ERROR);
  }
  const view = new DataView(field.buffer, field.byteOffset, field.byteLength);
  let pos = 0;
  if (uncompressedSize === SENTINEL_32) {
    pos += 8;
  }
  if (compressedSize === SENTINEL_32) {
    compressedSize = readSafeUint64(view, pos);
    pos += 8;
  }
  if (localHeaderOffset === SENTINEL_32) {
    localHeaderOffset = readSafeUint64(view, pos);
    pos += 8;
  }
  return { compressedSize, localHeaderOffset };
}

function parseCentralDirectory(bytes: Uint8Array, recordCount: number): CentralDirectoryRecord[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const records: CentralDirectoryRecord[] = [];
  let pos = 0;
  for (let i = 0; i < recordCount; i++) {
    if (
      pos + CENTRAL_DIRECTORY_FIXED_SIZE > bytes.length ||
      view.getUint32(pos, true) !== CENTRAL_DIRECTORY_SIGNATURE
    ) {
      throw new Error(ZIP_READ_ERROR);
    }
    const method = view.getUint16(pos + 10, true);
    const recordCrc32 = view.getUint32(pos + 16, true);
    const compressedSizeRaw = view.getUint32(pos + 20, true);
    const uncompressedSizeRaw = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localHeaderOffsetRaw = view.getUint32(pos + 42, true);
    const nameStart = pos + CENTRAL_DIRECTORY_FIXED_SIZE;
    const extraStart = nameStart + nameLen;
    if (extraStart + extraLen + commentLen > bytes.length) {
      throw new Error(ZIP_READ_ERROR);
    }
    const name = decoder.decode(bytes.subarray(nameStart, extraStart));
    const extra = bytes.subarray(extraStart, extraStart + extraLen);
    const { compressedSize, localHeaderOffset } = resolveZip64Sizes(
      extra,
      compressedSizeRaw,
      uncompressedSizeRaw,
      localHeaderOffsetRaw,
    );
    records.push({ name, method, compressedSize, crc32: recordCrc32, localHeaderOffset });
    pos = extraStart + extraLen + commentLen;
  }
  if (pos !== bytes.length) {
    throw new Error(ZIP_READ_ERROR);
  }
  return records;
}
// ローカルヘッダの名前長・extra 長は中央目録のものと食い違うことがある（spec 上どちらも
// 正当なので、実データの開始位置は必ずローカルヘッダ側の値から計算する）。
async function readEntryBlob(
  file: Blob,
  record: CentralDirectoryRecord,
): Promise<{ blob: Blob; inflated: Uint8Array | undefined }> {
  const header = new Uint8Array(
    await file
      .slice(record.localHeaderOffset, record.localHeaderOffset + LOCAL_FILE_HEADER_FIXED_SIZE)
      .arrayBuffer(),
  );
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (
    header.length < LOCAL_FILE_HEADER_FIXED_SIZE ||
    view.getUint32(0, true) !== LOCAL_FILE_HEADER_SIGNATURE
  ) {
    throw new Error(ZIP_READ_ERROR);
  }
  const nameLen = view.getUint16(26, true);
  const extraLen = view.getUint16(28, true);
  const dataStart = record.localHeaderOffset + LOCAL_FILE_HEADER_FIXED_SIZE + nameLen + extraLen;
  const dataEnd = dataStart + record.compressedSize;
  // Blob.slice は範囲外を黙って切り詰めて短い Blob を返す。目録が実体より大きいサイズを
  // 主張していた場合、確認しないと切り詰められた実体をそのまま復元してしまう。
  if (dataEnd > file.size) {
    throw new Error(ZIP_READ_ERROR);
  }
  if (record.method === 0) {
    return { blob: file.slice(dataStart, dataEnd), inflated: undefined };
  }
  if (record.method === 8) {
    const compressed = new Uint8Array(await file.slice(dataStart, dataEnd).arrayBuffer());
    const inflated = inflateSync(compressed);
    return { blob: new Blob([inflated]), inflated };
  }
  throw new Error(ZIP_READ_ERROR);
}
// CRC32 は非圧縮バイト列に対する値。store は実体をヒープに載せない設計を崩さないよう、
// 分割して読み捨てながら回す。
async function computeEntryCrc32(blob: Blob, inflated: Uint8Array | undefined): Promise<number> {
  if (inflated) {
    return crc32(inflated);
  }
  const hash = createCrc32();
  for (let pos = 0; pos < blob.size; pos += VERIFY_CHUNK_SIZE) {
    hash.update(new Uint8Array(await blob.slice(pos, pos + VERIFY_CHUNK_SIZE).arrayBuffer()));
  }
  return hash.digest();
}
// 他ツールが書いた zip も受け取る。data descriptor 付きを先頭から逐次読みすると、サイズも
// CRC も分からないまま次の PK\x07\x08 を探すしかなく、添付のバイナリ中に同じ 4 バイトが
// 出るだけで無音に切り詰まる（#280）。中央目録の真の値を読んで Blob.slice で直接飛ぶ。
// slice はコピーしないので store の添付はヒープに乗らない。
export async function parseBackupZip(file: Blob): Promise<ParsedBackupZip> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (!looksLikeZip(head)) {
    throw new Error(ZIP_READ_ERROR);
  }

  const { cdOffset, cdSize, recordCount } = await readCentralDirectoryLocation(file);
  const cdBytes = new Uint8Array(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const records = parseCentralDirectory(cdBytes, recordCount);

  let payload: BackupPayload | undefined;
  const attachmentBlobs = new Map<string, Blob>();
  // 1件目で打ち切らず全件見る。何件壊れているか分かる方が利用者の判断材料になる。
  const corruptNames: string[] = [];
  for (const record of records) {
    const isPayload = record.name === PAYLOAD_ENTRY_NAME;
    const isAttachment =
      record.name.startsWith(ATTACHMENT_PREFIX) && record.name.length > ATTACHMENT_PREFIX.length;
    if (!isPayload && !isAttachment) {
      continue;
    }
    const { blob, inflated } = await readEntryBlob(file, record);
    if ((await computeEntryCrc32(blob, inflated)) !== record.crc32) {
      corruptNames.push(record.name);
      continue;
    }
    if (isPayload) {
      try {
        payload = JSON.parse(await blob.text()) as BackupPayload;
      } catch {
        throw new Error(`zip 内の ${PAYLOAD_ENTRY_NAME} が JSON として読み込めませんでした`);
      }
    } else {
      attachmentBlobs.set(record.name.slice(ATTACHMENT_PREFIX.length), blob);
    }
  }
  // 硬く止めるのは payload.json 自体が壊れている場合だけ。添付だけなら続行し、何枚壊れて
  // いたかを返す——検証を通った帳簿まで一緒に捨てないため（#316）。
  if (corruptNames.includes(PAYLOAD_ENTRY_NAME)) {
    throw new BackupCorruptError(corruptNames);
  }
  if (!payload) {
    throw new Error(`zip 内に ${PAYLOAD_ENTRY_NAME} が見つかりません`);
  }
  return { payload, attachmentBlobs, corruptAttachmentNames: corruptNames };
}
