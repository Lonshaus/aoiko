import { describe, expect, test } from 'vitest';
import { AttachmentTooLargeError, buildAttachmentRecord } from './attachments';
import { MAX_IMAGE_BYTES } from '../lib/file-limit';

function makeFile(name: string, size: number, type: string): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe('buildAttachmentRecord', () => {
  test('通常のファイルからレコードを組み立てる', () => {
    const file = makeFile('receipt.jpg', 1000, 'image/jpeg');
    const r = buildAttachmentRecord('entry1', file, 123);
    expect(r.entryId).toBe('entry1');
    expect(r.fileName).toBe('receipt.jpg');
    expect(r.mimeType).toBe('image/jpeg');
    expect(r.createdAt).toBe(123);
    expect(r.blob).toBe(file);
    expect(r.id).toBeTruthy();
  });

  test('type が空なら application/octet-stream にフォールバック', () => {
    const file = makeFile('scan', 10, '');
    const r = buildAttachmentRecord('entry1', file, 1);
    expect(r.mimeType).toBe('application/octet-stream');
  });

  test('上限超過は AttachmentTooLargeError', () => {
    const file = makeFile('huge.jpg', MAX_IMAGE_BYTES + 1, 'image/jpeg');
    expect(() => buildAttachmentRecord('entry1', file, 1)).toThrow(AttachmentTooLargeError);
  });
});