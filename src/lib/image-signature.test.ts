import { describe, expect, test } from 'vitest';
import { isImageSignature, readImageSignature } from './image-signature';

describe('isImageSignature', () => {
  test('JPEG', () => {
    expect(isImageSignature(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe(true);
  });

  test('PNG', () => {
    expect(
      isImageSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])),
    ).toBe(true);
  });

  test('GIF87a / GIF89a', () => {
    expect(isImageSignature(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]))).toBe(true);
    expect(isImageSignature(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe(true);
  });

  test('WEBP', () => {
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(isImageSignature(bytes)).toBe(true);
  });

  test('BMP', () => {
    expect(isImageSignature(new Uint8Array([0x42, 0x4d, 0, 0]))).toBe(true);
  });

  test('HEIC', () => {
    const bytes = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
    expect(isImageSignature(bytes)).toBe(true);
  });

  test('PDF は画像として認識しない', () => {
    expect(isImageSignature(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))).toBe(false);
  });

  test('空・短すぎるバイト列は false', () => {
    expect(isImageSignature(new Uint8Array([]))).toBe(false);
    expect(isImageSignature(new Uint8Array([0xff]))).toBe(false);
  });
});

describe('readImageSignature', () => {
  test('File の先頭バイトから判定する', async () => {
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])], 'a.jpg');
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'a.pdf');
    await expect(readImageSignature(jpeg)).resolves.toBe(true);
    await expect(readImageSignature(pdf)).resolves.toBe(false);
  });
});
