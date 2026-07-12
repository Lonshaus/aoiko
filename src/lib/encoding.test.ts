import { describe, expect, test } from 'vitest';
import { decodeCsv } from './encoding';
import { mufgCardParser } from '../parsers/mufg-card';

describe('decodeCsv - shift_jis (CP932)', () => {
  test('多バイト漢字を正しく復号', () => {
    // 2026,店 ＝ [ascii..., 店=0x93 0x58]
    const bytes = Uint8Array.from([0x32, 0x30, 0x32, 0x36, 0x2c, 0x93, 0x58]);
    expect(decodeCsv(bytes, 'shift_jis')).toBe('2026,店');
  });

  test('機種依存文字（①㈱∑）と全角チルダ（～ U+FF5E）を復号', () => {
    // ①=8740 ㈱=878a ∑=8794 ～=8160
    const bytes = Uint8Array.from([0x87, 0x40, 0x87, 0x8a, 0x87, 0x94, 0x81, 0x60]);
    const decoded = decodeCsv(bytes, 'shift_jis');
    expect(decoded).toBe('①㈱∑～');
    // 全角チルダは U+FF5E（CP932 のマッピング）
    expect(decoded.charCodeAt(3)).toBe(0xff5e);
  });

  test('shift_jis バイト列が parser を通って明細になる', () => {
    // ヘッダー + 1 データ行を CP932 バイトで構築（店名に㈱を含む）。
    // ヘッダー："ご利用日,ご利用店名（海外ご利用店名／海外都市名）,ご利用金額（円）"
    // ただし mufg-card は requireColumns で列名一致を要求するため、
    // ここでは UTF-8 ヘッダー + shift_jis で復号した本文という擬似ではなく、
    // 復号後の文字列が parser を通ることだけを確認する（復号は decodeCsv の責務）。
    const header = 'ご利用日,ご利用店名（海外ご利用店名／海外都市名）,ご利用金額（円）';
    // 本文の店名に㈱（CP932 0x878a）を含むバイト列を復号して使う
    const shopBytes = Uint8Array.from([0x87, 0x8a]); // ㈱
    const shop = decodeCsv(shopBytes, 'shift_jis');
    const csv = `${header}\n2026/4/1,${shop}飲食,1234`;
    const r = mufgCardParser.parse(csv);
    expect(r).toHaveLength(1);
    expect(r[0]?.amount).toBe('1234');
    expect(r[0]?.description).toContain('㈱');
  });
});

describe('decodeCsv - utf-8', () => {
  test('BOM を除去する', () => {
    const bom = [0xef, 0xbb, 0xbf];
    const body = new TextEncoder().encode('日付,金額');
    const bytes = Uint8Array.from([...bom, ...body]);
    expect(decodeCsv(bytes, 'utf-8')).toBe('日付,金額');
  });
});
