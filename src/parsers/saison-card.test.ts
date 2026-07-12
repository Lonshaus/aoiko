import { describe, expect, test } from 'vitest';
import { saisonCardParser } from './saison-card';
import sample from './fixtures/saison-card-sample.csv?raw';

describe('saisonCardParser', () => {
  test('metadata', () => {
    expect(saisonCardParser.name).toBe('saison-card');
    expect(saisonCardParser.accountCode).toBe('2120');
    expect(saisonCardParser.encoding).toBe('shift_jis');
  });

  test('skips card-info preamble and parses明細', () => {
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

  test('omits memo for default 本人 / 1回, keeps非デフォルト', () => {
    const r = saisonCardParser.parse(sample);
    expect(r[0]?.memo).toBeUndefined();
    expect(r[2]?.memo).toBe('家族 / 3回 / 分割手数料あり');
  });

  test('throws when no header row is found', () => {
    expect(() => saisonCardParser.parse('foo,bar\n1,2')).toThrow(/CSV ヘッダー形式/);
  });
});
