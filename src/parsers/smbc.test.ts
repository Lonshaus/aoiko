import { describe, expect, test } from 'vitest';
import { smbcParser } from './smbc';
import { readSample } from './fixtures/_read';

const sample = readSample('src/parsers/fixtures/smbc-sample.csv', smbcParser.encoding);

describe('smbcParser', () => {
  test('メタデータ', () => {
    expect(smbcParser.name).toBe('smbc');
    expect(smbcParser.accountCode).toBe('1130');
    expect(smbcParser.encoding).toBe('shift_jis');
  });

  test('桁区切り付きのサンプルCSVを読み取る', () => {
    const r = smbcParser.parse(sample);
    expect(r).toHaveLength(3);

    expect(r[0]).toMatchObject({
      date: '2026-05-01',
      amount: '260000',
      side: 'debit',
    });
    expect(r[1]).toMatchObject({
      date: '2026-05-02',
      amount: '2500',
      side: 'credit',
    });
    expect(r[2]?.memo).toBe('業務');
  });

  test('必須列が欠けていれば例外を投げる', () => {
    const csv = '"年月日","お引出し","お預入れ"\n"2026/05/01","","100"';
    expect(() => smbcParser.parse(csv)).toThrow(/CSV ヘッダー形式/);
  });
});
