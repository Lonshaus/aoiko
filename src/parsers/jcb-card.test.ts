import { describe, expect, test } from 'vitest';
import { jcbCardParser } from './jcb-card';
import sample from './fixtures/jcb-card-sample.csv?raw';

describe('jcbCardParser', () => {
  test('metadata', () => {
    expect(jcbCardParser.name).toBe('jcb-card');
    expect(jcbCardParser.accountCode).toBe('2120');
    expect(jcbCardParser.encoding).toBe('shift_jis');
  });

  test('skips支払サマリ前言 and parses明細; 利用行は credit', () => {
    const r = jcbCardParser.parse(sample);
    expect(r).toHaveLength(4);
    for (const tx of r.slice(0, 3)) {
      expect(tx.side).toBe('credit');
    }
    expect(r[0]).toMatchObject({
      date: '2026-05-02',
      description: 'ＥＴＣチャージ',
      amount: '1200',
    });
    expect(r[1]?.amount).toBe('3300');
  });

  test('返品行（負数）は絶対値 + debit（未払金の減少）', () => {
    const r = jcbCardParser.parse(sample);
    const refund = r[3];
    expect(refund?.description).toBe('家電量販店 返品');
    expect(refund?.amount).toBe('5500');
    expect(refund?.side).toBe('debit');
  });

  test('trims leading space in date and keeps摘要 as memo', () => {
    const r = jcbCardParser.parse(sample);
    expect(r[2]?.date).toBe('2026-05-07');
    expect(r[2]?.amount).toBe('3080');
    expect(r[2]?.memo).toBe('内手数料１９円');
  });

  test('throws when no header row is found', () => {
    expect(() => jcbCardParser.parse('foo,bar\n1,2')).toThrow(/CSV ヘッダー形式/);
  });
});
