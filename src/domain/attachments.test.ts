import { describe, expect, test } from 'vitest';
import {
  AttachmentInvalidTypeError,
  AttachmentTooLargeError,
  buildAttachmentRecord,
} from './attachments';
import { MAX_IMAGE_BYTES } from '../lib/file-limit';

const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];

function makeFile(name: string, size: number, type: string, header: number[] = []): File {
  const bytes = new Uint8Array(size);
  bytes.set(header);
  return new File([bytes], name, { type });
}

describe('buildAttachmentRecord', () => {
  test('通常のファイルからレコードを組み立てる', async () => {
    const file = makeFile('receipt.jpg', 1000, 'image/jpeg', JPEG_HEADER);
    const r = await buildAttachmentRecord('entry1', file, 123);
    expect(r.entryId).toBe('entry1');
    expect(r.fileName).toBe('receipt.jpg');
    expect(r.mimeType).toBe('image/jpeg');
    expect(r.createdAt).toBe(123);
    expect(r.blob).toBe(file);
    expect(r.id).toBeTruthy();
  });

  test('type が空でも実体が画像なら application/octet-stream にフォールバック', async () => {
    // ある環境 あるブラウザ の HEIC 等、File.type が空になる実機挙動を想定
    const file = makeFile('scan.jpg', JPEG_HEADER.length, '', JPEG_HEADER);
    const r = await buildAttachmentRecord('entry1', file, 1);
    expect(r.mimeType).toBe('application/octet-stream');
  });

  test('上限超過は AttachmentTooLargeError', async () => {
    const file = makeFile('huge.jpg', MAX_IMAGE_BYTES + 1, 'image/jpeg', JPEG_HEADER);
    await expect(buildAttachmentRecord('entry1', file, 1)).rejects.toThrow(AttachmentTooLargeError);
  });

  test('MIME を偽装した PDF は AttachmentInvalidTypeError', async () => {
    const pdfHeader = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31];
    const file = makeFile('fake.jpg', 100, 'image/jpeg', pdfHeader);
    await expect(buildAttachmentRecord('entry1', file, 1)).rejects.toThrow(
      AttachmentInvalidTypeError,
    );
  });

  test('画像の先頭バイトを持たないファイルは拒否する', async () => {
    const file = makeFile('note.txt', 100, 'text/plain');
    await expect(buildAttachmentRecord('entry1', file, 1)).rejects.toThrow(
      AttachmentInvalidTypeError,
    );
  });
});
