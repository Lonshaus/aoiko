import { zipSync } from 'fflate';
import { describe, expect, test } from 'vitest';
import { BackupCorruptError, buildBackupZipStream, looksLikeZip, parseBackupZip } from './archive';
import type { BackupPayload } from './types';

async function* asyncAttachments(
  entries: ReadonlyArray<readonly [string, Uint8Array]>,
): AsyncGenerator<readonly [string, Uint8Array]> {
  for (const entry of entries) {
    yield entry;
  }
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe('looksLikeZip', () => {
  test('zip マジックナンバーを検出', () => {
    expect(looksLikeZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
  });
  test('JSON テキストは zip ではない', () => {
    expect(looksLikeZip(new TextEncoder().encode('{"version":1}'))).toBe(false);
  });
  test('4バイト未満は zip ではない', () => {
    expect(looksLikeZip(new Uint8Array([0x50, 0x4b]))).toBe(false);
  });
});

describe('buildBackupZipStream / parseBackupZip（ストリーミング形式・data descriptor 付き）', () => {
  test('payload と添付を往復できる', async () => {
    const payload: BackupPayload = {
      version: 1,
      exportedAt: '2026-07-08T00:00:00.000Z',
      tables: { journalEntries: [{ id: 'e1' }] },
    };
    const entries: Array<readonly [string, Uint8Array]> = [
      ['a1', new Uint8Array([1, 2, 3])],
      ['a2', new Uint8Array([4, 5])],
    ];
    const stream = buildBackupZipStream(payload, asyncAttachments(entries));
    const zip = await drain(stream);
    expect(looksLikeZip(zip)).toBe(true);

    const parsed = await parseBackupZip(new Blob([zip]));
    expect(parsed.payload).toEqual(payload);
    expect(parsed.attachmentBlobs.size).toBe(2);
    expect(await blobBytes(parsed.attachmentBlobs.get('a1')!)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await blobBytes(parsed.attachmentBlobs.get('a2')!)).toEqual(new Uint8Array([4, 5]));
  });

  test('添付が無くても往復できる', async () => {
    const payload: BackupPayload = { version: 1, exportedAt: '2026-07-08', tables: {} };
    const stream = buildBackupZipStream(payload, asyncAttachments([]));
    const zip = await drain(stream);
    const parsed = await parseBackupZip(new Blob([zip]));
    expect(parsed.payload).toEqual(payload);
    expect(parsed.attachmentBlobs.size).toBe(0);
  });

  test('0バイトの添付も往復できる', async () => {
    const payload: BackupPayload = { version: 1, exportedAt: '2026-07-08', tables: {} };
    const stream = buildBackupZipStream(payload, asyncAttachments([['empty', new Uint8Array([])]]));
    const zip = await drain(stream);
    const parsed = await parseBackupZip(new Blob([zip]));
    expect(parsed.attachmentBlobs.size).toBe(1);
    expect(await blobBytes(parsed.attachmentBlobs.get('empty')!)).toEqual(new Uint8Array([]));
  });

  test('途中で cancel しても例外にならない', async () => {
    const payload: BackupPayload = { version: 1, exportedAt: '2026-07-08', tables: {} };
    const entries: Array<readonly [string, Uint8Array]> = [
      ['a1', new Uint8Array([1])],
      ['a2', new Uint8Array([2])],
      ['a3', new Uint8Array([3])],
    ];
    const stream = buildBackupZipStream(payload, asyncAttachments(entries));
    const reader = stream.getReader();
    await reader.read();
    await expect(reader.cancel()).resolves.toBeUndefined();
  });

  test('添付取得中のエラーはストリームのエラーとして伝わる', async () => {
    const payload: BackupPayload = { version: 1, exportedAt: '2026-07-08', tables: {} };
    async function* failing(): AsyncGenerator<readonly [string, Uint8Array]> {
      yield ['a1', new Uint8Array([1])];
      throw new Error('読み取り失敗');
    }
    const stream = buildBackupZipStream(payload, failing());
    await expect(drain(stream)).rejects.toThrow('読み取り失敗');
  });
});

describe('parseBackupZip（旧形式・sizes をローカルヘッダに持つ zip）', () => {
  function buildLegacyZip(
    payload: BackupPayload,
    attachments: ReadonlyArray<readonly [string, Uint8Array]>,
  ): Uint8Array<ArrayBuffer> {
    const files: Record<string, Uint8Array> = {
      'payload.json': new TextEncoder().encode(JSON.stringify(payload)),
    };
    for (const [id, bytes] of attachments) {
      files[`attachments/${id}`] = bytes;
    }
    return zipSync(files, { level: 0 });
  }

  test('payload と添付を往復できる', async () => {
    const payload: BackupPayload = {
      version: 1,
      exportedAt: '2026-07-08T00:00:00.000Z',
      tables: { journalEntries: [{ id: 'e1' }] },
    };
    const zip = buildLegacyZip(payload, [
      ['a1', new Uint8Array([1, 2, 3])],
      ['a2', new Uint8Array([4, 5])],
    ]);
    const parsed = await parseBackupZip(new Blob([zip]));
    expect(parsed.payload).toEqual(payload);
    expect(parsed.attachmentBlobs.size).toBe(2);
    expect(await blobBytes(parsed.attachmentBlobs.get('a1')!)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await blobBytes(parsed.attachmentBlobs.get('a2')!)).toEqual(new Uint8Array([4, 5]));
  });

  test('0バイトの添付も往復できる', async () => {
    const payload: BackupPayload = { version: 1, exportedAt: '2026-07-08', tables: {} };
    const zip = buildLegacyZip(payload, [['empty', new Uint8Array([])]]);
    const parsed = await parseBackupZip(new Blob([zip]));
    expect(parsed.attachmentBlobs.size).toBe(1);
    expect(await blobBytes(parsed.attachmentBlobs.get('empty')!)).toEqual(new Uint8Array([]));
  });

  test('payload.json が無い zip はエラー', async () => {
    // 壊れた zip（マジックナンバーのみ）で payload.json 欠落を模擬
    const emptyEocd = new Uint8Array([
      0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    await expect(parseBackupZip(new Blob([emptyEocd]))).rejects.toThrow(/payload\.json/);
  });

  test('zip として読めないバイト列はエラー', async () => {
    await expect(parseBackupZip(new Blob([new TextEncoder().encode('not a zip')]))).rejects.toThrow(
      'zip として読み込めませんでした',
    );
  });
});
// 復元は失敗しても既存の帳簿を壊さないことが前提になっている。途中で切れたバックアップが
// 「一部だけ読めた」状態で通ると、欠けた帳簿で全置換してしまう。中央目録を読む方式は
// 末尾の EOCD が無いと目録の位置すら分からないため、末尾が欠けた zip は一律読めない。
describe('parseBackupZip（途中で切れたバックアップ）', () => {
  const payload: BackupPayload = { version: 1, exportedAt: '2026-07-08', tables: {} };
  const attachmentSize = 2000;

  async function completeZip(): Promise<Uint8Array<ArrayBuffer>> {
    const entries: Array<readonly [string, Uint8Array]> = [
      ['a1', new Uint8Array(attachmentSize).fill(7)],
      ['a2', new Uint8Array(attachmentSize).fill(9)],
    ];
    return drain(buildBackupZipStream(payload, asyncAttachments(entries)));
  }
  // EOCD（PK\x05\x06）に入っている中央目録の開始位置。添付の実体はすべてこれより前にある。
  function centralDirectoryOffset(zip: Uint8Array): number {
    for (let i = zip.length - 22; i >= 0; i--) {
      if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x05 && zip[i + 3] === 0x06) {
        return new DataView(zip.buffer, zip.byteOffset, zip.byteLength).getUint32(i + 16, true);
      }
    }
    throw new Error('EOCD が見つかりません');
  }

  test('添付の実体が欠けるところで切れていれば拒否する', async () => {
    const zip = await completeZip();
    const cut = centralDirectoryOffset(zip) - Math.floor(attachmentSize / 2);
    await expect(parseBackupZip(new Blob([zip.slice(0, cut)]))).rejects.toThrow(
      'zip として読み込めませんでした',
    );
  });
  // 実体は全部揃っていても、末尾の EOCD（中央目録の位置を指す唯一の手がかり）が
  // 無ければ目録自体を見つけられない。読めるはずのものでも安全側で拒否する。
  test('実体が揃っていて末尾の目録だけ欠けていれば拒否する', async () => {
    const zip = await completeZip();
    await expect(
      parseBackupZip(new Blob([zip.slice(0, centralDirectoryOffset(zip))])),
    ).rejects.toThrow('zip として読み込めませんでした');
  });
});
// data descriptor 付き zip をシグネチャ探索で読むストリーミング Unzip は、添付の
// バイナリ中に偶然 PK\x07\x08（データ記述子のシグネチャ）と同じ4バイトが出ただけで
// 実データの終端と誤認し、無音で切り詰める。中央目録から真のサイズを読む今の実装は
// この4バイトの中身に一切左右されない。
function buildDataDescriptorLookalike(): Uint8Array {
  const bytes = new Uint8Array(1000 + 4 + 5000);
  bytes.fill(0xaa, 0, 1000);
  bytes.set([0x50, 0x4b, 0x07, 0x08], 1000);
  bytes.fill(0xbb, 1004);
  return bytes;
}

describe('parseBackupZip（添付が PK\\x07\\x08 と同じバイト列を含む・#280 再発防止）', () => {
  const payload: BackupPayload = { version: 1, exportedAt: '2026-07-08', tables: {} };

  test('data descriptor 付き zip でも切り詰められず読める', async () => {
    const original = buildDataDescriptorLookalike();
    const stream = buildBackupZipStream(payload, asyncAttachments([['poison', original]]));
    const zip = await drain(stream);
    const parsed = await parseBackupZip(new Blob([zip]));
    expect(await blobBytes(parsed.attachmentBlobs.get('poison')!)).toEqual(original);
  });

  test('旧形式（サイズをローカルヘッダに持つ）zip でも読める', async () => {
    const original = buildDataDescriptorLookalike();
    const zip = zipSync(
      {
        'payload.json': new TextEncoder().encode(JSON.stringify(payload)),
        'attachments/poison': original,
      },
      { level: 0 },
    );
    const parsed = await parseBackupZip(new Blob([zip]));
    expect(await blobBytes(parsed.attachmentBlobs.get('poison')!)).toEqual(original);
  });
});

describe('parseBackupZip（大きめの添付・分割読みをまたぐケース）', () => {
  const payload: BackupPayload = { version: 1, exportedAt: '2026-07-08', tables: {} };
  const bigSize = 300 * 1024;

  function buildBig(): Uint8Array {
    const bytes = new Uint8Array(bigSize);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = i % 256;
    }
    return bytes;
  }

  test('ストリーミング形式で往復できる', async () => {
    const original = buildBig();
    const stream = buildBackupZipStream(payload, asyncAttachments([['big', original]]));
    const zip = await drain(stream);
    const parsed = await parseBackupZip(new Blob([zip]));
    expect(await blobBytes(parsed.attachmentBlobs.get('big')!)).toEqual(original);
  });

  test('旧形式で往復できる', async () => {
    const original = buildBig();
    const zip = zipSync(
      {
        'payload.json': new TextEncoder().encode(JSON.stringify(payload)),
        'attachments/big': original,
      },
      { level: 0 },
    );
    const parsed = await parseBackupZip(new Blob([zip]));
    expect(await blobBytes(parsed.attachmentBlobs.get('big')!)).toEqual(original);
  });
});

describe('parseBackupZip（他ツールが再圧縮した deflate zip）', () => {
  test('圧縮された添付を復元できる', async () => {
    const payload: BackupPayload = { version: 1, exportedAt: '2026-07-08', tables: {} };
    const original = new Uint8Array(2000);
    for (let i = 0; i < original.length; i++) {
      original[i] = (i * 7) % 256;
    }
    const zip = zipSync(
      {
        'payload.json': new TextEncoder().encode(JSON.stringify(payload)),
        'attachments/a1': original,
      },
      { level: 6 },
    );
    const parsed = await parseBackupZip(new Blob([zip]));
    expect(parsed.payload).toEqual(payload);
    expect(await blobBytes(parsed.attachmentBlobs.get('a1')!)).toEqual(original);
  });
});

describe('parseBackupZip（多数エントリの取り違え防止）', () => {
  test('40件の添付がすべて正しい ID に対応する', async () => {
    const payload: BackupPayload = { version: 1, exportedAt: '2026-07-08', tables: {} };
    const entries: Array<readonly [string, Uint8Array]> = [];
    for (let i = 0; i < 40; i++) {
      entries.push([`a${i}`, new Uint8Array([i, i + 1, i + 2])]);
    }
    const stream = buildBackupZipStream(payload, asyncAttachments(entries));
    const zip = await drain(stream);
    const parsed = await parseBackupZip(new Blob([zip]));
    expect(parsed.attachmentBlobs.size).toBe(40);
    for (let i = 0; i < 40; i++) {
      expect(await blobBytes(parsed.attachmentBlobs.get(`a${i}`)!)).toEqual(
        new Uint8Array([i, i + 1, i + 2]),
      );
    }
  });
});

describe('parseBackupZip（中央目録そのものが途中で切れている）', () => {
  test('目録を途中で削ると読めるべきでないものとして拒否する', async () => {
    const payload: BackupPayload = { version: 1, exportedAt: '2026-07-08', tables: {} };
    const entries: Array<readonly [string, Uint8Array]> = [
      ['a1', new Uint8Array([1, 2, 3])],
      ['a2', new Uint8Array([4, 5, 6])],
    ];
    const zip = await drain(buildBackupZipStream(payload, asyncAttachments(entries)));
    const cdOffsetView = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    let eocdOffset = -1;
    for (let i = zip.length - 22; i >= 0; i--) {
      if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x05 && zip[i + 3] === 0x06) {
        eocdOffset = i;
        break;
      }
    }
    const cdStart = cdOffsetView.getUint32(eocdOffset + 16, true);
    const cutStart = cdStart + 10;
    const cutEnd = eocdOffset - 5;
    const cut = new Uint8Array(zip.length - (cutEnd - cutStart));
    cut.set(zip.subarray(0, cutStart), 0);
    cut.set(zip.subarray(cutEnd), cutStart);
    await expect(parseBackupZip(new Blob([cut]))).rejects.toThrow('zip として読み込めませんでした');
  });
});
// Blob.slice は範囲外を黙って切り詰める。目録が実体より大きいサイズを主張していても
// エラーにならず短い Blob が返るため、切り詰められた添付をそのまま復元してしまう。
describe('parseBackupZip（目録が実体より大きいサイズを主張している）', () => {
  test('実体が足りなければ拒否する', async () => {
    const payload: BackupPayload = { version: 1, exportedAt: '2026-07-08', tables: {} };
    const zip = await drain(
      buildBackupZipStream(payload, asyncAttachments([['a1', new Uint8Array(100).fill(3)]])),
    );
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    let eocdOffset = -1;
    for (let i = zip.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    const cdStart = view.getUint32(eocdOffset + 16, true);
    // 先頭レコードの圧縮後サイズ（中央目録レコード先頭 +20）をファイル長より大きくする
    const tampered = new Uint8Array(zip);
    new DataView(tampered.buffer).setUint32(cdStart + 20, zip.length + 1000, true);
    await expect(parseBackupZip(new Blob([tampered]))).rejects.toThrow(
      'zip として読み込めませんでした',
    );
  });
});
// 中央目録の CRC32 と実体から計算した CRC32 の照合（#281）。ビット単位の破損は
// サイズも目録も無傷なまま起きるため、照合しない限り壊れたまま復元されてしまう。
describe('parseBackupZip（CRC32 照合）', () => {
  const payload: BackupPayload = {
    version: 1,
    exportedAt: '2026-07-08T00:00:00.000Z',
    tables: { journalEntries: [{ id: 'e1' }] },
  };

  function eocdOffsetOf(zip: Uint8Array): number {
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let i = zip.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        return i;
      }
    }
    throw new Error('EOCD が見つかりません');
  }
  // 実体の開始位置は中央目録のローカルヘッダオフセットから引く（実装と同じ経路をたどる）。
  function entryDataOffset(zip: Uint8Array, name: string): number {
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const eocd = eocdOffsetOf(zip);
    const count = view.getUint16(eocd + 10, true);
    const decoder = new TextDecoder();
    let pos = view.getUint32(eocd + 16, true);
    for (let i = 0; i < count; i++) {
      const nameLen = view.getUint16(pos + 28, true);
      const extraLen = view.getUint16(pos + 30, true);
      const commentLen = view.getUint16(pos + 32, true);
      const localOffset = view.getUint32(pos + 42, true);
      if (decoder.decode(zip.subarray(pos + 46, pos + 46 + nameLen)) === name) {
        const localNameLen = view.getUint16(localOffset + 26, true);
        const localExtraLen = view.getUint16(localOffset + 28, true);
        return localOffset + 30 + localNameLen + localExtraLen;
      }
      pos = pos + 46 + nameLen + extraLen + commentLen;
    }
    throw new Error(`${name} が目録に見つかりません`);
  }

  function flipBits(zip: Uint8Array, offsets: readonly number[]): Uint8Array<ArrayBuffer> {
    const copy = new Uint8Array(zip);
    for (const offset of offsets) {
      copy[offset] = copy[offset]! ^ 0x01;
    }
    return copy;
  }

  async function expectCorrupt(zip: Uint8Array<ArrayBuffer>): Promise<BackupCorruptError> {
    try {
      await parseBackupZip(new Blob([zip]));
    } catch (err) {
      expect(err).toBeInstanceOf(BackupCorruptError);
      return err as BackupCorruptError;
    }
    throw new Error('BackupCorruptError が投げられませんでした');
  }

  test('無傷なら照合を入れても復元できる（deflate の payload.json + 無圧縮の添付）', async () => {
    const original = new Uint8Array(3000);
    for (let i = 0; i < original.length; i++) {
      original[i] = (i * 13) % 256;
    }
    const zip = zipSync({
      'payload.json': [new TextEncoder().encode(JSON.stringify(payload)), { level: 6 }],
      'attachments/a1': [original, { level: 0 }],
    });
    const parsed = await parseBackupZip(new Blob([zip]));
    expect(parsed.payload).toEqual(payload);
    expect(await blobBytes(parsed.attachmentBlobs.get('a1')!)).toEqual(original);
  });

  test('無圧縮の添付の 1 ビットが反転していれば拒否し、その添付名を返す', async () => {
    const zip = await drain(
      buildBackupZipStream(
        payload,
        asyncAttachments([
          ['a1', new Uint8Array(500).fill(7)],
          ['a2', new Uint8Array(500).fill(9)],
        ]),
      ),
    );
    const tampered = flipBits(zip, [entryDataOffset(zip, 'attachments/a1') + 123]);
    const err = await expectCorrupt(tampered);
    expect(err.entryNames).toEqual(['attachments/a1']);
    expect(err.message).toContain('1 件');
  });

  test('payload.json が化けていれば拒否する', async () => {
    const zip = await drain(
      buildBackupZipStream(payload, asyncAttachments([['a1', new Uint8Array(100).fill(1)]])),
    );
    const tampered = flipBits(zip, [entryDataOffset(zip, 'payload.json') + 5]);
    const err = await expectCorrupt(tampered);
    expect(err.entryNames).toEqual(['payload.json']);
  });

  test('壊れた添付が 2 件あれば 1 件目で打ち切らず両方を返す', async () => {
    const zip = await drain(
      buildBackupZipStream(
        payload,
        asyncAttachments([
          ['a1', new Uint8Array(500).fill(7)],
          ['a2', new Uint8Array(500).fill(9)],
          ['a3', new Uint8Array(500).fill(11)],
        ]),
      ),
    );
    const tampered = flipBits(zip, [
      entryDataOffset(zip, 'attachments/a1') + 10,
      entryDataOffset(zip, 'attachments/a3') + 400,
    ]);
    const err = await expectCorrupt(tampered);
    expect(err.entryNames).toEqual(['attachments/a1', 'attachments/a3']);
    expect(err.message).toContain('2 件');
  });
  // 目録が実体より小さいサイズを主張していると Blob.slice は素直に短い実体を返す。
  // サイズ検査だけでは通ってしまうが、切り詰められた実体は CRC が合わない（#281）。
  test('目録のサイズが実体より小さく書き換わっていれば拒否する', async () => {
    const zip = await drain(
      buildBackupZipStream(payload, asyncAttachments([['a1', new Uint8Array(500).fill(7)]])),
    );
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const eocd = eocdOffsetOf(zip);
    const cdStart = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    let pos = cdStart;
    for (let i = 0; i < view.getUint16(eocd + 10, true); i++) {
      const nameLen = view.getUint16(pos + 28, true);
      if (decoder.decode(zip.subarray(pos + 46, pos + 46 + nameLen)) === 'attachments/a1') {
        break;
      }
      pos = pos + 46 + nameLen + view.getUint16(pos + 30, true) + view.getUint16(pos + 32, true);
    }
    const tampered = new Uint8Array(zip);
    new DataView(tampered.buffer).setUint32(pos + 20, 400, true);
    const err = await expectCorrupt(tampered);
    expect(err.entryNames).toEqual(['attachments/a1']);
  });
  // 分割読みの単位（1 MiB）をまたぐ添付。境界の取り違えは大きなファイルでしか出ない。
  describe('分割読みの境界', () => {
    const chunkSize = 1024 * 1024;

    function bigBytes(size: number): Uint8Array {
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i++) {
        bytes[i] = (i * 31 + 7) % 256;
      }
      return bytes;
    }
    // toEqual は 1 MiB の型付き配列だと差分生成に 1 秒近くかかるので、全要素一致だけ見る。
    async function expectSameBytes(blob: Blob, expected: Uint8Array): Promise<void> {
      const bytes = await blobBytes(blob);
      expect(bytes.length).toBe(expected.length);
      expect(bytes.every((b, i) => b === expected[i])).toBe(true);
    }

    test('ちょうど 1 MiB の添付を復元できる', async () => {
      const original = bigBytes(chunkSize);
      const zip = await drain(buildBackupZipStream(payload, asyncAttachments([['big', original]])));
      const parsed = await parseBackupZip(new Blob([zip]));
      await expectSameBytes(parsed.attachmentBlobs.get('big')!, original);
    });

    test('1 MiB を超える添付を復元でき、2 番目のかたまり内の破損も検出する', async () => {
      const original = bigBytes(chunkSize + 12345);
      const zip = await drain(buildBackupZipStream(payload, asyncAttachments([['big', original]])));
      const parsed = await parseBackupZip(new Blob([zip]));
      await expectSameBytes(parsed.attachmentBlobs.get('big')!, original);

      const tampered = flipBits(zip, [entryDataOffset(zip, 'attachments/big') + chunkSize + 9000]);
      const err = await expectCorrupt(tampered);
      expect(err.entryNames).toEqual(['attachments/big']);
    });
  });
});
