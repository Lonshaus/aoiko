import { describe, expect, test } from 'vitest';
import { paypayCardParser } from './paypay-card';
import { readSample } from './fixtures/_read';

const sampleCsv = readSample(
  'src/parsers/fixtures/paypay-card-sample.csv',
  paypayCardParser.encoding,
);

describe('paypayCardParser', () => {
  test('パーサーのメタデータ', () => {
    expect(paypayCardParser.name).toBe('paypay-card');
    expect(paypayCardParser.displayName).toBe('PayPayカード');
    expect(paypayCardParser.accountCode).toBe('2120');
    expect(paypayCardParser.encoding).toBe('utf-8');
  });

  test('サンプルCSVが期待どおりの取引に変換される', () => {
    const result = paypayCardParser.parse(sampleCsv);
    expect(result).toHaveLength(4);

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

  test('「1回」「本人*」だけならメモに出さない', () => {
    const result = paypayCardParser.parse(sampleCsv);
    expect(result[2]?.memo).toBeUndefined();
  });

  test('キャンセル行（負数）は絶対値 + 借方（未払金の減少）', () => {
    const result = paypayCardParser.parse(sampleCsv);
    expect(result[3]).toMatchObject({
      date: '2026-02-12',
      description: 'ヨドバシカメラ キャンセル',
      amount: '3000',
      side: 'debit',
    });
  });

  test('CRLF の改行を扱える', () => {
    const withCrlf = sampleCsv.replace(/\n/g, '\r\n');
    const result = paypayCardParser.parse(withCrlf);
    expect(result).toHaveLength(4);
  });

  test('金額の桁区切りカンマを取り除く', () => {
    const csv =
      '"利用日/キャンセル日","利用店名・商品名","利用金額"\n' + '"2026/05/01","テスト","1,234,567"';
    const result = paypayCardParser.parse(csv);
    expect(result[0]?.amount).toBe('1234567');
  });

  test('金額が空の行は飛ばす', () => {
    const csv =
      '"利用日/キャンセル日","利用店名・商品名","利用金額"\n' +
      '"2026/05/01","空",""\n' +
      '"2026/05/02","正常","100"';
    const result = paypayCardParser.parse(csv);
    expect(result).toHaveLength(1);
    expect(result[0]?.description).toBe('正常');
  });

  test('認識できないヘッダーは例外を投げる', () => {
    const csv = '"DATE","SHOP","AMOUNT"\n"2026/05/01","x","100"';
    expect(() => paypayCardParser.parse(csv)).toThrow(/CSV ヘッダー形式と一致しません/);
  });

  test('ヘッダーだけの CSV は空を返す', () => {
    const csv = '"利用日/キャンセル日","利用店名・商品名","利用金額"';
    expect(paypayCardParser.parse(csv)).toEqual([]);
  });

  test('rawRow は元のヘッダー名をキーにした値を持つ', () => {
    const result = paypayCardParser.parse(sampleCsv);
    expect(result[0]?.rawRow['利用日/キャンセル日']).toBe('2026/1/31');
    expect(result[0]?.rawRow['利用店名・商品名']).toBe('ネットフリックス');
  });
});
