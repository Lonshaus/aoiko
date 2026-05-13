import { describe, expect, test } from 'vitest';
import { paypayCardParser } from './paypay-card';
import sampleCsv from './fixtures/paypay-card-sample.csv?raw';

describe('paypayCardParser', () => {
  test('parser metadata', () => {
    expect(paypayCardParser.name).toBe('paypay-card');
    expect(paypayCardParser.displayName).toBe('PayPayカード');
    expect(paypayCardParser.accountCode).toBe('2120');
    expect(paypayCardParser.encoding).toBe('shift_jis');
  });

  test('sample fixture parses to expected transactions', () => {
    const result = paypayCardParser.parse(sampleCsv);
    expect(result).toHaveLength(5);

    expect(result[0]).toMatchObject({
      date: '2026-05-02',
      description: 'アマゾン.コ.ジエイピー',
      amount: '3280',
      side: 'credit',
    });
    expect(result[0]?.memo).toBeUndefined();

    expect(result[2]).toMatchObject({
      date: '2026-05-08',
      description: 'ヨドバシカメラ',
      amount: '48400',
      side: 'credit',
      memo: '分割3回 / 業務用機材',
    });

    expect(result[3]).toMatchObject({
      date: '2026-05-12',
      description: 'ＡＤＯＢＥ',
      amount: '6480',
      side: 'credit',
      memo: 'Creative Cloud',
    });
  });

  test('一括 alone is not surfaced as memo', () => {
    const result = paypayCardParser.parse(sampleCsv);
    expect(result[1]?.memo).toBeUndefined();
  });

  test('handles BOM-prefixed input', () => {
    const withBom = '﻿' + sampleCsv;
    const result = paypayCardParser.parse(withBom);
    expect(result).toHaveLength(5);
  });

  test('handles CRLF line endings', () => {
    const withCrlf = sampleCsv.replace(/\n/g, '\r\n');
    const result = paypayCardParser.parse(withCrlf);
    expect(result).toHaveLength(5);
  });

  test('strips thousand-separator commas from amounts', () => {
    const csv =
      '"ご利用日","ご利用店名","ご利用金額","支払区分","摘要"\n' +
      '"2026/05/01","テスト","1,234,567","一括",""';
    const result = paypayCardParser.parse(csv);
    expect(result[0]?.amount).toBe('1234567');
  });

  test('skips rows with empty amount', () => {
    const csv =
      '"ご利用日","ご利用店名","ご利用金額","支払区分","摘要"\n' +
      '"2026/05/01","空","","一括",""\n' +
      '"2026/05/02","正常","100","一括",""';
    const result = paypayCardParser.parse(csv);
    expect(result).toHaveLength(1);
    expect(result[0]?.description).toBe('正常');
  });

  test('throws on unrecognized header', () => {
    const csv = '"DATE","SHOP","AMOUNT"\n"2026/05/01","x","100"';
    expect(() => paypayCardParser.parse(csv)).toThrow(
      /CSV ヘッダー形式と一致しません/
    );
  });

  test('returns empty for header-only CSV', () => {
    const csv = '"ご利用日","ご利用店名","ご利用金額","支払区分","摘要"';
    expect(paypayCardParser.parse(csv)).toEqual([]);
  });

  test('rawRow contains original header-keyed values', () => {
    const result = paypayCardParser.parse(sampleCsv);
    expect(result[0]?.rawRow['ご利用日']).toBe('2026/05/02');
    expect(result[0]?.rawRow['ご利用店名']).toBe('アマゾン.コ.ジエイピー');
  });
});