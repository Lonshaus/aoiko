import { describe, expect, test } from 'vitest';
import { saisonCardParser } from './saison-card';
import { readSample } from './fixtures/_read';

const sample = readSample('src/parsers/fixtures/saison-card-sample.csv', saisonCardParser.encoding);

describe('saisonCardParser', () => {
  test('メタデータ', () => {
    expect(saisonCardParser.name).toBe('saison-card');
    expect(saisonCardParser.accountCode).toBe('2120');
    expect(saisonCardParser.encoding).toBe('shift_jis');
  });

  test('冒頭のカード情報行を飛ばして明細を読む', () => {
    const r = saisonCardParser.parse(sample);
    expect(r).toHaveLength(3);
    for (const tx of r) {
      expect(tx.side).toBe('credit');
    }
    expect(r[0]).toMatchObject({
      date: '2026-05-01',
      description: 'コンビニ店',
      amount: '450',
    });
    expect(r[1]?.amount).toBe('2200');
  });

  test('既定の「本人 / 1回」ならメモを省き、既定以外は残す', () => {
    const r = saisonCardParser.parse(sample);
    expect(r[0]?.memo).toBeUndefined();
    expect(r[2]?.memo).toBe('家族 / 3回 / 分割手数料あり');
  });

  test('ヘッダー行が見つからなければ例外を投げる', () => {
    expect(() => saisonCardParser.parse('foo,bar\n1,2')).toThrow(/CSV ヘッダー形式/);
  });
});
