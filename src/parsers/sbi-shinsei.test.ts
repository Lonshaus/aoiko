import { describe, expect, test } from 'vitest';
import { sbiShinseiParser } from './sbi-shinsei';
import sampleCsv from './fixtures/sbi-shinsei-sample.csv?raw';

describe('sbiShinseiParser', () => {
  test('parser metadata', () => {
    expect(sbiShinseiParser.name).toBe('sbi-shinsei');
    expect(sbiShinseiParser.displayName).toBe('SBI新生銀行');
    expect(sbiShinseiParser.accountCode).toBe('1130');
    expect(sbiShinseiParser.encoding).toBe('utf-8');
  });

  test('sample fixture parses to expected transactions', () => {
    const result = sbiShinseiParser.parse(sampleCsv);
    expect(result).toHaveLength(4);

    expect(result[0]).toMatchObject({
      date: '2026-02-26',
      description: 'ATM 現金入金（提携取引）',
      amount: '270000',
      side: 'debit',
      balance: '270000',
    });

    expect(result[2]).toMatchObject({
      date: '2026-03-03',
      description: 'セブン-イレブン',
      amount: '450',
      side: 'credit',
      memo: '業務',
    });
  });

  test('empty memo not included in result', () => {
    const result = sbiShinseiParser.parse(sampleCsv);
    expect(result[0]?.memo).toBeUndefined();
  });

  test('handles CRLF line endings', () => {
    const withCrlf = sampleCsv.replace(/\n/g, '\r\n');
    const result = sbiShinseiParser.parse(withCrlf);
    expect(result).toHaveLength(4);
  });

  test('strips thousand-separator commas from amounts', () => {
    const csv =
      '"取引日","摘要","出金金額","入金金額","残高","メモ"\n' +
      '"2026/05/01","テスト","","1,234,567","2,000,000",""';
    const result = sbiShinseiParser.parse(csv);
    expect(result[0]?.amount).toBe('1234567');
    expect(result[0]?.balance).toBe('2000000');
  });

  test('skips rows with both columns empty', () => {
    const csv =
      '"取引日","摘要","出金金額","入金金額","残高","メモ"\n' +
      '"2026/05/01","空行テスト","","","300,000",""\n' +
      '"2026/05/02","正常","","100","300,100",""';
    const result = sbiShinseiParser.parse(csv);
    expect(result).toHaveLength(1);
    expect(result[0]?.description).toBe('正常');
  });

  test('throws on unrecognized header', () => {
    const csv = '"DATE","DESC","OUT","IN"\n"2026/05/01","x","100",""';
    expect(() => sbiShinseiParser.parse(csv)).toThrow(
      /CSV ヘッダー形式と一致しません/
    );
  });

  test('returns empty for header-only CSV', () => {
    const csv = '"取引日","摘要","出金金額","入金金額","残高","メモ"';
    expect(sbiShinseiParser.parse(csv)).toEqual([]);
  });

  test('rawRow contains original header-keyed values', () => {
    const result = sbiShinseiParser.parse(sampleCsv);
    expect(result[0]?.rawRow['取引日']).toBe('2026/02/26');
    expect(result[0]?.rawRow['摘要']).toBe('ATM 現金入金（提携取引）');
  });
});