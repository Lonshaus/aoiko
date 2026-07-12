// このファイルもテンプレート。実際の parser テストファイルを作るときの雛形。
// Auto-discovery と vitest 双方から除外（vitest.config.ts の exclude 設定 + `_` プレフィックス）。

import { describe, expect, test } from 'vitest';
import myBankParser from './_template.example';
import sample from './fixtures/_template.example-sample.csv?raw';

describe('myBankParser', () => {
  test('metadata', () => {
    expect(myBankParser.name).toBe('my-bank');
    expect(myBankParser.accountCode).toBe('1130');
    expect(myBankParser.encoding).toBe('shift_jis');
  });

  test('parses sample fixture', () => {
    const r = myBankParser.parse(sample);
    expect(r).toHaveLength(2);

    expect(r[0]).toMatchObject({
      date: '2026-05-01',
      description: '給与',
      amount: '300000',
      side: 'debit',
    });
    expect(r[1]).toMatchObject({
      description: 'コンビニ',
      amount: '500',
      side: 'credit',
    });
  });

  test('throws on missing required column', () => {
    const csv = '日付,摘要\n2026/05/01,test';
    expect(() => myBankParser.parse(csv)).toThrow(/CSV ヘッダー形式/);
  });
});
