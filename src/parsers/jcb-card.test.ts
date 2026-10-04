import { describe, expect, test } from 'vitest';
import { jcbCardParser } from './jcb-card';
import { readSample } from './fixtures/_read';

const sample = readSample('src/parsers/fixtures/jcb-card-sample.csv', jcbCardParser.encoding);

describe('jcbCardParser', () => {
  test('メタデータ', () => {
    expect(jcbCardParser.name).toBe('jcb-card');
    expect(jcbCardParser.accountCode).toBe('2120');
    expect(jcbCardParser.encoding).toBe('shift_jis');
  });

  test('支払サマリ冒頭の情報行を飛ばして明細を読む。利用行は貸方', () => {
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

  test('返品行（負数）は絶対値 + 借方（未払金の減少）', () => {
    const r = jcbCardParser.parse(sample);
    const refund = r[3];
    expect(refund?.description).toBe('家電量販店 返品');
    expect(refund?.amount).toBe('5500');
    expect(refund?.side).toBe('debit');
  });

  test('日付の先頭の空白を除き、摘要をメモに残す', () => {
    const r = jcbCardParser.parse(sample);
    expect(r[2]?.date).toBe('2026-05-07');
    expect(r[2]?.amount).toBe('3080');
    expect(r[2]?.memo).toBe('内手数料１９円');
  });

  test('ヘッダー行が見つからなければ例外を投げる', () => {
    expect(() => jcbCardParser.parse('foo,bar\n1,2')).toThrow(/CSV ヘッダー形式/);
  });
});
