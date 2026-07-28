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

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
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

describe('buildBackupZipStream / parseBackupZip', () => {
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

    const parsed = await parseBackupZip(zip);
    expect(parsed.payload).toEqual(payload);
    expect(parsed.attachmentBlobs.size).toBe(2);
    expect(parsed.attachmentBlobs.get('a1')).toEqual(new Uint8Array([1, 2, 3]));
    expect(parsed.attachmentBlobs.get('a2')).toEqual(new Uint8Array([4, 5]));
  });

  test('添付が無くても往復できる', async () => {
    const payload: BackupPayload = { version: 1, exportedAt: '2026-07-08', tables: {} };
    const stream = buildBackupZipStream(payload, asyncAttachments([]));
    const zip = await drain(stream);
    const parsed = await parseBackupZip(zip);
    expect(parsed.payload).toEqual(payload);
    expect(parsed.attachmentBlobs.size).toBe(0);
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

  test('payload.json が無い zip はエラー', async () => {
    // 壊れた zip（マジックナンバーのみ）で payload.json 欠落を模擬
    await expect(
      parseBackupZip(
        new Uint8Array([
          0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ]),
      ),
    ).rejects.toThrow(/payload\.json/);
  });

  test('zip として読めないバイト列はエラー', async () => {
    await expect(parseBackupZip(new TextEncoder().encode('not a zip'))).rejects.toThrow();
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
