import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';
// 既知ベクタ（RFC 6234 / NIST）。実装を書き換えたときにここが崩れる。
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('sha256Hex', () => {
  it('既知ベクタと一致する', async () => {
    await expect(sha256Hex(new Uint8Array())).resolves.toBe(EMPTY);
    await expect(sha256Hex(new TextEncoder().encode('abc'))).resolves.toBe(ABC);
  });

  it('Blob・ArrayBuffer・Uint8Array のどれで渡しても同じ', async () => {
    const bytes = new TextEncoder().encode('abc');
    const results = await Promise.all([
      sha256Hex(bytes),
      sha256Hex(bytes.buffer as ArrayBuffer),
      sha256Hex(new Blob([bytes])),
    ]);
    expect(new Set(results)).toEqual(new Set([ABC]));
  });

  it('view の範囲だけを見る（buffer 全体ではない）', async () => {
    // 前後に別のバイトを置いた buffer から 'abc' 部分だけを切り出す。buffer 全体を
    // 渡す実装だとここが EMPTY でも ABC でもない値になる。
    const backing = new Uint8Array([0xff, 0xff, 0x61, 0x62, 0x63, 0xff]);
    const view = backing.subarray(2, 5);
    await expect(sha256Hex(view)).resolves.toBe(ABC);
  });

  it('1 バイト違えば別の値になる', async () => {
    const a = await sha256Hex(new Uint8Array([1, 2, 3]));
    const b = await sha256Hex(new Uint8Array([1, 2, 4]));
    expect(a).not.toBe(b);
    expect(a).toHaveLength(64);
  });
});
