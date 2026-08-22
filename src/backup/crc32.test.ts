import { describe, expect, test } from 'vitest';
import { createCrc32, crc32 } from './crc32';

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('crc32（既知の答え合わせ）', () => {
  test('空入力は 0', () => {
    expect(crc32(new Uint8Array([]))).toBe(0);
  });

  test('"123456789" は 0xCBF43926', () => {
    expect(crc32(bytesOf('123456789'))).toBe(0xcbf43926);
  });

  test('"The quick brown fox..." は 0x414FA339', () => {
    expect(crc32(bytesOf('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });

  test('0x00〜0xFF の全バイト列は 0x29058C73', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = i;
    }
    expect(crc32(bytes)).toBe(0x29058c73);
  });
  // 最上位ビットが立つ値。符号付き 32bit として扱っていれば負数になる。
  test('日本語（UTF-8）は 0xA1917623 で、符号なしで返る', () => {
    const digest = crc32(bytesOf('青色申告 令和8年分'));
    expect(digest).toBe(0xa1917623);
    expect(digest).toBeGreaterThan(0);
  });
});

describe('createCrc32（分割して渡す）', () => {
  test('分割して update しても一括と同じ digest になる', () => {
    const bytes = bytesOf('青色申告 令和8年分');
    for (const size of [1, 3, 7, bytes.length - 1, bytes.length]) {
      const hash = createCrc32();
      for (let pos = 0; pos < bytes.length; pos += size) {
        hash.update(bytes.subarray(pos, pos + size));
      }
      expect(hash.digest()).toBe(crc32(bytes));
    }
  });

  test('空の update を挟んでも結果は変わらない', () => {
    const hash = createCrc32();
    hash.update(new Uint8Array([]));
    hash.update(bytesOf('1234'));
    hash.update(new Uint8Array([]));
    hash.update(bytesOf('56789'));
    expect(hash.digest()).toBe(0xcbf43926);
  });

  test('一度も update しなければ 0', () => {
    expect(createCrc32().digest()).toBe(0);
  });

  test('digest を二度呼んでも同じ値', () => {
    const hash = createCrc32();
    hash.update(bytesOf('123456789'));
    expect(hash.digest()).toBe(hash.digest());
  });
});
