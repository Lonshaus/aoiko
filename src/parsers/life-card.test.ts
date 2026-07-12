import { describe, expect, test } from 'vitest';
import { lifeCardParser } from './life-card';
import sample from './fixtures/life-card-sample.csv?raw';

describe('lifeCardParser', () => {
  test('metadata', () => {
    expect(lifeCardParser.name).toBe('life-card');
    expect(lifeCardParser.accountCode).toBe('2120');
    expect(lifeCardParser.encoding).toBe('shift_jis');
  });

  test('明細表のみ抽出し後続の内訳表は無視する', () => {
    const r = lifeCardParser.parse(sample);
    expect(r).toHaveLength(3);
    for (const tx of r) {
      expect(tx.side).toBe('credit');
    }
    expect(r[0]).toMatchObject({
      date: '2026-05-03',
      description: 'コンビニ店',
      amount: '811',
    });
    expect(r[0]?.memo).toBeUndefined();
  });

  test('非デフォルトの回数・契約を memo に残す', () => {
    const r = lifeCardParser.parse(sample);
    expect(r[1]).toMatchObject({ amount: '30000', memo: '3回払' });
    expect(r[2]).toMatchObject({ amount: '50000', memo: 'キャッシング' });
  });

  test('throws when no header row is found', () => {
    expect(() => lifeCardParser.parse('foo,bar\n1,2')).toThrow(/CSV ヘッダー形式/);
  });
});
