import { describe, expect, test } from 'vitest';
import { rakutenCardParser } from './rakuten-card';
import sample from './fixtures/rakuten-card-sample.csv?raw';

describe('rakutenCardParser', () => {
  test('metadata', () => {
    expect(rakutenCardParser.name).toBe('rakuten-card');
    expect(rakutenCardParser.accountCode).toBe('2120');
    expect(rakutenCardParser.encoding).toBe('utf-8');
  });

  test('parses sample fixture; 利用行は credit (未払金 増)', () => {
    const r = rakutenCardParser.parse(sample);
    expect(r).toHaveLength(4);
    for (const tx of r.slice(0, 3)) {
      expect(tx.side).toBe('credit');
    }
    expect(r[0]?.description).toBe('amazon.co.jp');
    expect(r[0]?.amount).toBe('2500');
    expect(r[1]?.amount).toBe('8800');
  });

  test('返品行（負数）は絶対値 + debit（未払金の減少）', () => {
    const r = rakutenCardParser.parse(sample);
    const refund = r[3];
    expect(refund?.description).toBe('amazon.co.jp 返品');
    expect(refund?.amount).toBe('2500');
    expect(refund?.side).toBe('debit');
  });

  test('omits memo for default 本人 / 1回払い', () => {
    const r = rakutenCardParser.parse(sample);
    expect(r[0]?.memo).toBeUndefined();
  });

  test('keeps memo for non-default user / payment method', () => {
    const r = rakutenCardParser.parse(sample);
    expect(r[2]?.memo).toBe('家族 / 3回払い');
  });
});
