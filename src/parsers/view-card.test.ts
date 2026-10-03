import { describe, expect, test } from 'vitest';
import { viewCardParser } from './view-card';
import { readSample } from './fixtures/_read';

const sample = readSample('src/parsers/fixtures/view-card-sample.csv', viewCardParser.encoding);

describe('viewCardParser', () => {
  test('メタデータ', () => {
    expect(viewCardParser.name).toBe('view-card');
    expect(viewCardParser.accountCode).toBe('2120');
    expect(viewCardParser.encoding).toBe('shift_jis');
  });

  test('冒頭の情報行とカード会員行を飛ばして明細を読む', () => {
    const r = viewCardParser.parse(sample);
    expect(r).toHaveLength(4);
    expect(r[0]).toMatchObject({
      date: '2026-04-11',
      description: '駅ビル店',
      amount: '1135',
      side: 'credit',
    });
    expect(r[0]?.memo).toBeUndefined();
  });

  test('既定以外の支払区分をメモに残す', () => {
    const r = viewCardParser.parse(sample);
    expect(r[1]).toMatchObject({ amount: '3000', memo: '３回払' });
  });

  test('払戻額のみの行は借方（未払金の減）', () => {
    const r = viewCardParser.parse(sample);
    expect(r[2]).toMatchObject({
      date: '2026-04-20',
      amount: '500',
      side: 'debit',
    });
  });

  test('ご利用額がマイナス表記の行は符号を反転して借方にする', () => {
    const r = viewCardParser.parse(sample);
    expect(r[3]).toMatchObject({
      date: '2026-04-25',
      amount: '800',
      side: 'debit',
    });
  });

  test('ヘッダー行が見つからなければ例外を投げる', () => {
    expect(() => viewCardParser.parse('foo,bar\n1,2')).toThrow(/CSV ヘッダー形式/);
  });
});
