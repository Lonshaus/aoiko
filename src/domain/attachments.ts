import type { Attachment } from '../db/types';
import { newId } from '../lib/id';
import { exceedsLimit, MAX_IMAGE_BYTES } from '../lib/file-limit';
import { readImageSignature } from '../lib/image-signature';

export class AttachmentTooLargeError extends Error {
  constructor(
    public readonly size: number,
    public readonly limit: number,
  ) {
    super('添付ファイルのサイズが上限を超えています');
    this.name = 'AttachmentTooLargeError';
  }
}

export class AttachmentInvalidTypeError extends Error {
  constructor() {
    super('対応していないファイル形式です。証憑写真は画像ファイルのみ添付できます。');
    this.name = 'AttachmentInvalidTypeError';
  }
}
// 証憑写真（C7）を分錄と同一 transaction で書き込むためのレコードを組み立てる。
// File は Blob を継承しているのでコピー不要でそのまま保持できる。
// File.type は accept 属性のヒントに過ぎずドラッグ&ドロップ等で容易に偽装・欠落するため、
// 先頭バイトのマジックナンバーで実体が画像かどうかを検証する。
export async function buildAttachmentRecord(
  entryId: string,
  file: File,
  now: number,
): Promise<Attachment> {
  if (exceedsLimit(file.size, MAX_IMAGE_BYTES)) {
    throw new AttachmentTooLargeError(file.size, MAX_IMAGE_BYTES);
  }
  if (!(await readImageSignature(file))) {
    throw new AttachmentInvalidTypeError();
  }
  return {
    id: newId(),
    entryId,
    blob: file,
    mimeType: file.type || 'application/octet-stream',
    fileName: file.name,
    createdAt: now,
  };
}
