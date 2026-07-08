import type { Attachment } from '../db/types';
import { newId } from '../lib/id';
import { exceedsLimit, MAX_IMAGE_BYTES } from '../lib/file-limit';

export class AttachmentTooLargeError extends Error {
  constructor(public readonly size: number, public readonly limit: number) {
    super('添付ファイルのサイズが上限を超えています');
    this.name = 'AttachmentTooLargeError';
  }
}
// 証憑写真（C7）を分錄と同一 transaction で書き込むためのレコードを組み立てる。
// File は Blob を継承しているのでコピー不要でそのまま保持できる。
export function buildAttachmentRecord(entryId: string, file: File, now: number): Attachment {
  if (exceedsLimit(file.size, MAX_IMAGE_BYTES)) {
    throw new AttachmentTooLargeError(file.size, MAX_IMAGE_BYTES);
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