import { describe, expect, test } from 'vitest';
import { paypayCardParser } from './paypay-card';
import sampleCsv from './fixtures/paypay-card-sample.csv?raw';

describe('paypayCardParser', () => {
  test('parser metadata', () => {
    expect(paypayCardParser.name).toBe('paypay-card');
    expect(paypayCardParser.displayName).toBe('PayPayカード');
    expect(paypayCardParser.accountCode).toBe('2120');
    expect(paypayCardParser.encoding).toBe('utf-8');
  });

  test('sample fixture parses to expected transactions', () => {
    const result = paypayCardParser.parse(sampleCsv);
    expect(result).toHaveLength(3);

    expect(result[0]).toMatchObject({
      date: '2026-01-31',
      description: 'ネットフリックス',
      amount: '2290',
      side: 'credit',
    });
    expect(result[0]?.memo).toBeUndefined();

    expect(result[1]).toMatchObject({
      date: '2026-02-03',
      description: 'ヨドバシカメラ',
      amount: '48000',
      side: 'credit',
      memo: '分割3回',
    });
  });

  test('1回 / 本人* alone are not surfaced as memo', () => {
    const result = paypayCardParser.parse(sampleCsv);
    expect(result[2]?.memo).toBeUndefined();
  });

  test('handles CRLF line endings', () => {
    const withCrlf = sampleCsv.replace(/\n/g, '\r\n');
    const result = paypayCardParser.parse(withCrlf);
    expect(result).toHaveLength(3);
  });

  test('strips thousand-separator commas from amounts', () => {
    const csv =
      '"利用日/キャンセル日","利用店名・商品名","利用金額"\n' +
      '"2026/05/01","テスト","1,234,567"';
    const result = paypayCardParser.parse(csv);
    expect(result[0]?.amount).toBe('1234567');
  });

  test('skips rows with empty amount', () => {
    const csv =
      '"利用日/キャンセル日","利用店名・商品名","利用金額"\n' +
      '"2026/05/01","空",""\n' +
      '"2026/05/02","正常","100"';
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
    const csv = '"利用日/キャンセル日","利用店名・商品名","利用金額"';
    expect(paypayCardParser.parse(csv)).toEqual([]);
  });

  test('rawRow contains original header-keyed values', () => {
    const result = paypayCardParser.parse(sampleCsv);
    expect(result[0]?.rawRow['利用日/キャンセル日']).toBe('2026/1/31');
    expect(result[0]?.rawRow['利用店名・商品名']).toBe('ネットフリックス');
  });
});