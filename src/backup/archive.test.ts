import { describe, expect, test } from 'vitest';
import { buildBackupZip, looksLikeZip, parseBackupZip } from './archive';
import type { BackupPayload } from './types';

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

describe('buildBackupZip / parseBackupZip', () => {
  test('payload と添付を往復できる', () => {
    const payload: BackupPayload = {
      version: 1,
      exportedAt: '2026-07-08T00:00:00.000Z',
      tables: { journalEntries: [{ id: 'e1' }] },
    };
    const blobs = new Map([
      ['a1', new Uint8Array([1, 2, 3])],
      ['a2', new Uint8Array([4, 5])],
    ]);
    const zip = buildBackupZip(payload, blobs);
    expect(looksLikeZip(zip)).toBe(true);

    const parsed = parseBackupZip(zip);
    expect(parsed.payload).toEqual(payload);
    expect(parsed.attachmentBlobs.size).toBe(2);
    expect(parsed.attachmentBlobs.get('a1')).toEqual(new Uint8Array([1, 2, 3]));
    expect(parsed.attachmentBlobs.get('a2')).toEqual(new Uint8Array([4, 5]));
  });

  test('添付が無くても往復できる', () => {
    const payload: BackupPayload = { version: 1, exportedAt: '2026-07-08', tables: {} };
    const zip = buildBackupZip(payload, new Map());
    const parsed = parseBackupZip(zip);
    expect(parsed.payload).toEqual(payload);
    expect(parsed.attachmentBlobs.size).toBe(0);
  });

  test('payload.json が無い zip はエラー', () => {
    const zip = buildBackupZip({ version: 1, exportedAt: '', tables: {} }, new Map());
    // 壊れた zip（マジックナンバーのみ）で payload.json 欠落を模擬
    expect(() => parseBackupZip(new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toThrow(
      /payload\.json/
    );
  });

  test('zip として読めないバイト列はエラー', () => {
    expect(() => parseBackupZip(new TextEncoder().encode('not a zip'))).toThrow();
  });
});