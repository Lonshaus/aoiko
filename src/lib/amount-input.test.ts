import { describe, expect, test } from 'vitest';
import { isAmountInputInvalid, normalizeAmountInput, parseAmountInput } from './amount-input';

describe('金額欄の入力の読み取り', () => {
  test.each([
    ['5000', '5000'],
    ['５０００', '5000'],
    ['５，０００', '5000'],
    ['5,000', '5000'],
    [' 5000 ', '5000'],
    ['　5000　', '5000'],
    ['1234.5', '1234.5'],
    ['０', '0'],
  ])('%j は %s として読む', (raw, expected) => {
    expect(parseAmountInput(raw)?.toString()).toBe(expected);
    expect(isAmountInputInvalid(raw)).toBe(false);
  });

  test.each(['-5000', '－5000', '5,000円', 'abc', '1e3', '0x10', '5000.'])(
    '%j は金額として読まず、入力の誤りとして扱う',
    (raw) => {
      expect(parseAmountInput(raw)).toBeUndefined();
      expect(isAmountInputInvalid(raw)).toBe(true);
    },
  );

  test('空欄と空白だけの欄は未入力で、誤りではない', () => {
    for (const raw of ['', '   ', '　']) {
      expect(parseAmountInput(raw)).toBeUndefined();
      expect(isAmountInputInvalid(raw)).toBe(false);
    }
  });

  test('文字列以外は例外を投げず未入力として扱う', () => {
    for (const v of [5000, null, undefined, true, {}]) {
      expect(parseAmountInput(v)).toBeUndefined();
    }
  });

  test.each([
    ['-5000', '-5000'],
    ['－5000', '-5000'],
    [' -1234.5 ', '-1234.5'],
    ['－５，０００', '-5000'],
    ['5000', '5000'],
  ])('負を許すと %j は %s として読む', (raw, expected) => {
    expect(parseAmountInput(raw, { allowNegative: true })?.toString()).toBe(expected);
  });

  test.each(['', '--5', '5-', '-', '5,000円', '1e3', '0x10', '-5000.', '+5'])(
    '負を許しても %j は読まない',
    (raw) => {
      expect(parseAmountInput(raw, { allowNegative: true })).toBeUndefined();
    },
  );

  test('正規化は全角を半角へ、桁区切りと前後の空白を除き、それ以外は残す', () => {
    expect(normalizeAmountInput('　５，０００　')).toBe('5000');
    expect(normalizeAmountInput('abc')).toBe('abc');
    expect(normalizeAmountInput('－5000')).toBe('-5000');
  });
});
