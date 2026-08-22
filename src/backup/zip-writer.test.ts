import { describe, expect, test } from 'vitest';
import { unzipSync } from 'fflate';
import { crc32 } from './crc32';
import { ZipStoreWriter } from './zip-writer';
// 自前の書き出しなので、検証には自分のリーダーではなく fflate の unzipSync を使う。
// 同じ勘違いをした読み書きが揃って通ってしまうのを避けるため（archive.test.ts の往復
// テストが自前リーダー側を受け持つ）。
const MTIME = new Date(2026, 6, 15, 10, 30, 0);

function build(
  entries: Array<[string, Uint8Array]>,
  options?: { zip64Threshold?: number },
): Uint8Array {
  const writer = new ZipStoreWriter(MTIME, options);
  const chunks: Uint8Array[] = [];
  for (const [name, bytes] of entries) {
    chunks.push(...writer.addEntry(name, bytes));
  }
  chunks.push(writer.finish());
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function findSignature(zip: Uint8Array, signature: number): number {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let i = 0; i + 4 <= zip.length; i++) {
    if (view.getUint32(i, true) === signature) {
      return i;
    }
  }
  return -1;
}

const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const EOCD_SIGNATURE = 0x06054b50;

describe('ZipStoreWriter（通常の書庫）', () => {
  test('fflate で読み戻せる', () => {
    const zip = build([
      ['payload.json', bytes('{"a":1}')],
      ['attachments/abc', bytes('hello')],
    ]);
    const out = unzipSync(zip);
    expect(Object.keys(out).sort()).toEqual(['attachments/abc', 'payload.json']);
    expect(new TextDecoder().decode(out['payload.json'])).toBe('{"a":1}');
    expect(new TextDecoder().decode(out['attachments/abc'])).toBe('hello');
  });

  test('閾値以下では zip64 レコードを出さない', () => {
    const zip = build([['payload.json', bytes('{}')]]);
    expect(findSignature(zip, ZIP64_EOCD_SIGNATURE)).toBe(-1);
    expect(findSignature(zip, ZIP64_EOCD_LOCATOR_SIGNATURE)).toBe(-1);
  });

  test('エントリが無くても読める', () => {
    const zip = build([]);
    expect(zip.length).toBe(22);
    expect(unzipSync(zip)).toEqual({});
  });

  test('0 バイトのエントリも読める', () => {
    const out = unzipSync(build([['attachments/empty', new Uint8Array(0)]]));
    expect(out['attachments/empty']?.length).toBe(0);
  });

  test('CRC32 が実データの値と一致する', () => {
    const data = bytes('the quick brown fox');
    const zip = build([['attachments/x', data]]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    // ローカルヘッダの crc32 は先頭から 14 バイト目。
    expect(view.getUint32(14, true)).toBe(crc32(data));
  });

  test('バイナリをそのまま通す（PK\\x07\\x08 を含んでも切れない）', () => {
    const data = new Uint8Array([0x50, 0x4b, 0x07, 0x08, 0, 1, 2, 3, 0x50, 0x4b, 0x03, 0x04]);
    const out = unzipSync(build([['attachments/tricky', data]]));
    expect(Array.from(out['attachments/tricky'] ?? [])).toEqual(Array.from(data));
  });

  test('UTF-8 の名前を保つ', () => {
    const out = unzipSync(build([['attachments/領収書-①.jpg', bytes('x')]]));
    expect(Object.keys(out)).toEqual(['attachments/領収書-①.jpg']);
  });
});

describe('ZipStoreWriter（zip64）', () => {
  // 4GiB を実際に確保できないので閾値を下げて分岐を通す。sentinel（0xFFFFFFFF）を
  // 32bit 欄に書き、真の値を拡張フィールドへ回す挙動そのものは本番と同じ。
  const options = { zip64Threshold: 8 };

  test('閾値を超えたら zip64 EOCD とロケータを出す', () => {
    const zip = build(
      [
        ['a', bytes('0123456789')],
        ['b', bytes('0123456789')],
      ],
      options,
    );
    expect(findSignature(zip, ZIP64_EOCD_SIGNATURE)).toBeGreaterThan(-1);
    expect(findSignature(zip, ZIP64_EOCD_LOCATOR_SIGNATURE)).toBeGreaterThan(-1);
  });

  test('従来の EOCD には sentinel が入る', () => {
    const zip = build([['a', bytes('0123456789')]], options);
    const eocd = zip.length - 22;
    expect(findSignature(zip.subarray(eocd), EOCD_SIGNATURE)).toBe(0);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint32(eocd + 12, true)).toBe(0xffffffff);
    expect(view.getUint32(eocd + 16, true)).toBe(0xffffffff);
  });

  test('zip64 EOCD が件数・目録サイズ・目録位置を持つ', () => {
    const zip = build(
      [
        ['a', bytes('0123456789')],
        ['b', bytes('0123456789')],
      ],
      options,
    );
    const at = findSignature(zip, ZIP64_EOCD_SIGNATURE);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(Number(view.getBigUint64(at + 32, true))).toBe(2);
    const cdSize = Number(view.getBigUint64(at + 40, true));
    const cdOffset = Number(view.getBigUint64(at + 48, true));
    // 目録は実体の直後から始まり、zip64 EOCD の直前で終わる。
    expect(cdOffset + cdSize).toBe(at);
  });

  test('zip64 でも fflate で読み戻せる', () => {
    const out = unzipSync(
      build(
        [
          ['payload.json', bytes('{"big":true}')],
          ['attachments/one', bytes('0123456789abcdef')],
        ],
        options,
      ),
    );
    expect(new TextDecoder().decode(out['payload.json'])).toBe('{"big":true}');
    expect(new TextDecoder().decode(out['attachments/one'])).toBe('0123456789abcdef');
  });

  test('サイズだけが閾値を超える場合も読み戻せる', () => {
    // 1 件目は閾値未満、2 件目だけが超える。エントリごとに判定していることの確認。
    const out = unzipSync(
      build(
        [
          ['a', bytes('x')],
          ['b', bytes('0123456789')],
        ],
        options,
      ),
    );
    expect(new TextDecoder().decode(out['a'])).toBe('x');
    expect(new TextDecoder().decode(out['b'])).toBe('0123456789');
  });
});

describe('ZipStoreWriter（境界）', () => {
  test('65535 件ちょうどで zip64 に切り替える', () => {
    // 65535 は EOCD の件数欄の sentinel と同じ値。ここで zip64 に切り替えないと、
    // 読み手が「zip64 がある」と誤解して壊れる。
    const entries: Array<[string, Uint8Array]> = [];
    for (let i = 0; i < 65535; i++) {
      entries.push([`a${i}`, new Uint8Array(0)]);
    }
    const zip = build(entries);
    expect(findSignature(zip, ZIP64_EOCD_SIGNATURE)).toBeGreaterThan(-1);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const eocd = zip.length - 22;
    expect(view.getUint16(eocd + 8, true)).toBe(0xffff);
    expect(view.getUint16(eocd + 10, true)).toBe(0xffff);
  });

  test('65534 件では zip64 にしない', () => {
    const entries: Array<[string, Uint8Array]> = [];
    for (let i = 0; i < 65534; i++) {
      entries.push([`a${i}`, new Uint8Array(0)]);
    }
    const zip = build(entries);
    expect(findSignature(zip, ZIP64_EOCD_SIGNATURE)).toBe(-1);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint16(zip.length - 22 + 10, true)).toBe(65534);
  });
});

describe('ZipStoreWriter（誤用）', () => {
  test('finish() は 2 回呼べない', () => {
    const writer = new ZipStoreWriter(MTIME);
    writer.finish();
    expect(() => writer.finish()).toThrow();
  });

  test('finish() の後に追加できない', () => {
    const writer = new ZipStoreWriter(MTIME);
    writer.finish();
    expect(() => writer.addEntry('a', new Uint8Array(0))).toThrow();
  });
});
