import { zipSync } from 'fflate';
import { describe, expect, test } from 'vitest';
import { buildBackupZipStream, looksLikeZip, parseBackupZip } from './archive';
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
// 「一部だけ読めた」状態で通ると、欠けた帳簿で全置換してしまう。ストリーミング読み込みは
// 末尾から EOCD を探さないため、この性質を明示的に固定する。
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
  // 末尾の目録だけが欠けた場合は、添付の実体は全部揃っている。読めるものを拒否する必要はない。
  test('実体が揃っていて末尾の目録だけ欠けていれば読める', async () => {
    const zip = await completeZip();
    const parsed = await parseBackupZip(new Blob([zip.slice(0, centralDirectoryOffset(zip))]));
    expect(parsed.payload).toEqual(payload);
    expect(parsed.attachmentBlobs.size).toBe(2);
    expect(await blobBytes(parsed.attachmentBlobs.get('a1')!)).toHaveLength(attachmentSize);
    expect(await blobBytes(parsed.attachmentBlobs.get('a2')!)).toHaveLength(attachmentSize);
  });
});
