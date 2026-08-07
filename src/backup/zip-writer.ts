import { crc32 } from './crc32';
// 無圧縮（store）専用の zip 書き出し。自前で持つ理由は #396——fflate の書き出しは zip64 を
// 出さず、4GiB 超のオフセットを例外なしに巻き戻して書く。
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EXTRA_ID = 0x0001;
const LOCAL_FILE_HEADER_FIXED_SIZE = 30;
const CENTRAL_DIRECTORY_FIXED_SIZE = 46;
const EOCD_SIZE = 22;
const ZIP64_EOCD_FIXED_SIZE = 56;
const ZIP64_EOCD_LOCATOR_SIZE = 20;
const METHOD_STORE = 0;
const VERSION_STORE = 20;
const VERSION_ZIP64 = 45;
// 汎用フラグ bit 11＝ファイル名が UTF-8。
const FLAG_UTF8 = 0x0800;
// sentinel と同値も zip64 の合図として読まれるので、切り替えは「超えたら」でなく「達したら」。
const SENTINEL_16 = 0xffff;
const SENTINEL_32 = 0xffffffff;

interface CentralEntry {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = date.getFullYear();
  // MS-DOS 形式は 1980〜2107 のみ。端末の時計が狂っていても範囲外を書かないよう丸める。
  const dosYear = Math.min(Math.max(year - 1980, 0), 127);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: (dosYear << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export class ZipStoreWriter {
  private readonly entries: CentralEntry[] = [];
  private offset = 0;
  private readonly dos: { time: number; date: number };
  private readonly zip64Threshold: number;
  private finished = false;
  // zip64Threshold はテスト専用。4GiB を確保せずに zip64 経路を通す手段が他に無い。
  constructor(mtime: Date, options?: { zip64Threshold?: number }) {
    this.dos = dosDateTime(mtime);
    this.zip64Threshold = options?.zip64Threshold ?? SENTINEL_32;
  }
  // 実体をコピーしないよう、ヘッダと実体を分けて返す。
  addEntry(name: string, bytes: Uint8Array): readonly Uint8Array[] {
    if (this.finished) {
      throw new Error('finish() の後にエントリは追加できません');
    }
    const nameBytes = new TextEncoder().encode(name);
    const size = bytes.length;
    const crc = crc32(bytes);
    const needsSizeZip64 = size >= this.zip64Threshold;
    // ローカルヘッダの zip64 拡張は、使うなら両サイズを必ず並べる（オフセットは目録側のみ）。
    const extraSize = needsSizeZip64 ? 20 : 0;
    const header = new Uint8Array(LOCAL_FILE_HEADER_FIXED_SIZE + nameBytes.length + extraSize);
    const view = new DataView(header.buffer);
    view.setUint32(0, LOCAL_FILE_HEADER_SIGNATURE, true);
    view.setUint16(4, needsSizeZip64 ? VERSION_ZIP64 : VERSION_STORE, true);
    view.setUint16(6, FLAG_UTF8, true);
    view.setUint16(8, METHOD_STORE, true);
    view.setUint16(10, this.dos.time, true);
    view.setUint16(12, this.dos.date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, needsSizeZip64 ? SENTINEL_32 : size, true);
    view.setUint32(22, needsSizeZip64 ? SENTINEL_32 : size, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, extraSize, true);
    header.set(nameBytes, LOCAL_FILE_HEADER_FIXED_SIZE);
    if (needsSizeZip64) {
      const at = LOCAL_FILE_HEADER_FIXED_SIZE + nameBytes.length;
      view.setUint16(at, ZIP64_EXTRA_ID, true);
      view.setUint16(at + 2, 16, true);
      view.setBigUint64(at + 4, BigInt(size), true);
      view.setBigUint64(at + 12, BigInt(size), true);
    }

    this.entries.push({ name: nameBytes, crc, size, offset: this.offset });
    this.offset += header.length + size;
    return [header, bytes];
  }

  private centralRecord(entry: CentralEntry): Uint8Array {
    const needsSizeZip64 = entry.size >= this.zip64Threshold;
    const needsOffsetZip64 = entry.offset >= this.zip64Threshold;
    // 元の 32bit 欄が sentinel になったものだけを、非圧縮→圧縮→オフセットの順に並べる。
    const zip64Payload = (needsSizeZip64 ? 16 : 0) + (needsOffsetZip64 ? 8 : 0);
    const extraSize = zip64Payload > 0 ? zip64Payload + 4 : 0;
    const record = new Uint8Array(CENTRAL_DIRECTORY_FIXED_SIZE + entry.name.length + extraSize);
    const view = new DataView(record.buffer);
    view.setUint32(0, CENTRAL_DIRECTORY_SIGNATURE, true);
    view.setUint16(4, VERSION_STORE, true);
    view.setUint16(6, extraSize > 0 ? VERSION_ZIP64 : VERSION_STORE, true);
    view.setUint16(8, FLAG_UTF8, true);
    view.setUint16(10, METHOD_STORE, true);
    view.setUint16(12, this.dos.time, true);
    view.setUint16(14, this.dos.date, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, needsSizeZip64 ? SENTINEL_32 : entry.size, true);
    view.setUint32(24, needsSizeZip64 ? SENTINEL_32 : entry.size, true);
    view.setUint16(28, entry.name.length, true);
    view.setUint16(30, extraSize, true);
    view.setUint32(42, needsOffsetZip64 ? SENTINEL_32 : entry.offset, true);
    record.set(entry.name, CENTRAL_DIRECTORY_FIXED_SIZE);
    if (extraSize > 0) {
      let at = CENTRAL_DIRECTORY_FIXED_SIZE + entry.name.length;
      view.setUint16(at, ZIP64_EXTRA_ID, true);
      view.setUint16(at + 2, zip64Payload, true);
      at += 4;
      if (needsSizeZip64) {
        view.setBigUint64(at, BigInt(entry.size), true);
        view.setBigUint64(at + 8, BigInt(entry.size), true);
        at += 16;
      }
      if (needsOffsetZip64) {
        view.setBigUint64(at, BigInt(entry.offset), true);
      }
    }
    return record;
  }
  finish(): Uint8Array {
    if (this.finished) {
      throw new Error('finish() は 1 回だけ呼べます');
    }
    this.finished = true;

    const cdOffset = this.offset;
    const records = this.entries.map((e) => this.centralRecord(e));
    const cdSize = records.reduce((sum, r) => sum + r.length, 0);
    const count = this.entries.length;
    const needsZip64 =
      count >= SENTINEL_16 || cdSize >= this.zip64Threshold || cdOffset >= this.zip64Threshold;

    const tailSize =
      cdSize + (needsZip64 ? ZIP64_EOCD_FIXED_SIZE + ZIP64_EOCD_LOCATOR_SIZE : 0) + EOCD_SIZE;
    const tail = new Uint8Array(tailSize);
    let pos = 0;
    for (const record of records) {
      tail.set(record, pos);
      pos += record.length;
    }
    const view = new DataView(tail.buffer);

    if (needsZip64) {
      const zip64EocdOffset = cdOffset + cdSize;
      view.setUint32(pos, ZIP64_EOCD_SIGNATURE, true);
      // 記録サイズは自分自身の先頭 12 バイトを除いた長さ。
      view.setBigUint64(pos + 4, BigInt(ZIP64_EOCD_FIXED_SIZE - 12), true);
      view.setUint16(pos + 12, VERSION_ZIP64, true);
      view.setUint16(pos + 14, VERSION_ZIP64, true);
      view.setUint32(pos + 16, 0, true);
      view.setUint32(pos + 20, 0, true);
      view.setBigUint64(pos + 24, BigInt(count), true);
      view.setBigUint64(pos + 32, BigInt(count), true);
      view.setBigUint64(pos + 40, BigInt(cdSize), true);
      view.setBigUint64(pos + 48, BigInt(cdOffset), true);
      pos += ZIP64_EOCD_FIXED_SIZE;

      view.setUint32(pos, ZIP64_EOCD_LOCATOR_SIGNATURE, true);
      view.setUint32(pos + 4, 0, true);
      view.setBigUint64(pos + 8, BigInt(zip64EocdOffset), true);
      view.setUint32(pos + 16, 1, true);
      pos += ZIP64_EOCD_LOCATOR_SIZE;
    }

    view.setUint32(pos, EOCD_SIGNATURE, true);
    view.setUint16(pos + 4, 0, true);
    view.setUint16(pos + 6, 0, true);
    view.setUint16(pos + 8, count >= SENTINEL_16 ? SENTINEL_16 : count, true);
    view.setUint16(pos + 10, count >= SENTINEL_16 ? SENTINEL_16 : count, true);
    view.setUint32(pos + 12, cdSize >= this.zip64Threshold ? SENTINEL_32 : cdSize, true);
    view.setUint32(pos + 16, cdOffset >= this.zip64Threshold ? SENTINEL_32 : cdOffset, true);
    view.setUint16(pos + 20, 0, true);

    this.offset += tailSize;
    return tail;
  }
}
