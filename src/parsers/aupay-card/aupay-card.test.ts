import { describe, expect, test } from 'vitest';
import { auPayCardParser } from './aupay-card';
import { readSample } from '../fixtures/_read';

const sample = readSample('src/parsers/aupay-card/aupay-card-sample.csv', auPayCardParser.encoding);

describe('auPayCardParser', () => {
  test('メタデータ', () => {
    expect(auPayCardParser.name).toBe('aupay-card');
    expect(auPayCardParser.displayName).toBe('au PAY カード');
    expect(auPayCardParser.accountCode).toBe('2120');
    expect(auPayCardParser.encoding).toBe('shift_jis');
  });

  test('サンプルCSVを読み取る。全行が貸方', () => {
    const r = auPayCardParser.parse(sample);
    expect(r).toHaveLength(3);
    for (const tx of r) {
      expect(tx.side).toBe('credit');
    }
    expect(r[0]).toMatchObject({
      date: '2026-02-26',
      description: '通信料金',
      amount: '330',
    });
    expect(r[0]?.memo).toBeUndefined();
    expect(r[1]).toMatchObject({
      amount: '45000',
      memo: '分割3回 / 業務用機材',
    });
  });

  test('必須列が欠けていれば例外を投げる', () => {
    const csv = '"利用日","利用金額"\n"2026/05/01","350"';
    expect(() => auPayCardParser.parse(csv)).toThrow(/CSV ヘッダー形式/);
  });
});
