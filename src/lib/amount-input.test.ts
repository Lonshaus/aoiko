import { describe, expect, test } from 'vitest';
import {
  isAmountInputInvalid,
  isJournalAmountTooLarge,
  normalizeAmountInput,
  parseAmountInput,
  parseIntegerInput,
  readStoredAmount,
  storedToInputText,
} from './amount-input';

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

describe('parseIntegerInput', () => {
  const range = { min: 0, max: 12 };

  test.each([
    ['12', 12],
    ['０', 0],
    ['１２', 12],
    [' 5 ', 5],
    ['1,0', 10],
  ])('%j は %i として読む', (raw, expected) => {
    expect(parseIntegerInput(raw, range)).toBe(expected);
  });

  test.each(['', '   ', '13', '-1', '2.5', '1e1', '0x1', 'abc', '5円'])(
    '%j は範囲外・整数でない・空欄なので undefined',
    (raw) => {
      expect(parseIntegerInput(raw, range)).toBeUndefined();
    },
  );

  test('文字列以外は undefined', () => {
    expect(parseIntegerInput(5, range)).toBeUndefined();
    expect(parseIntegerInput(null, range)).toBeUndefined();
  });

  test('負の下限も指定できる', () => {
    expect(parseIntegerInput('-3', { min: -5, max: 5 })).toBe(-3);
  });
});

describe('isJournalAmountTooLarge', () => {
  test.each(['100000000000000', '１００００００００００００００', '1000000000000000000000'])(
    '%j は 1e14 以上',
    (raw) => {
      expect(isJournalAmountTooLarge(raw)).toBe(true);
    },
  );

  test.each(['99999999999999', '99,999,999,999,999.99', '0', '', 'abc', '1e15', 5])(
    '%j は過大ではない（読めない値は別の誤りとして扱う）',
    (raw) => {
      expect(isJournalAmountTooLarge(raw)).toBe(false);
    },
  );

  test('全角の数字も金額として読む', () => {
    expect(parseAmountInput('１０００')?.toString()).toBe('1000');
  });
});

describe('readStoredAmount', () => {
  test.each([
    ['1e3', '1000'],
    ['0x10', '16'],
    ['1e-7', '1e-7'],
    [5000, '5000'],
    ['-5', '-5'],
  ])('%j を読む', (v, expected) => {
    expect(readStoredAmount(v)?.toString()).toBe(expected);
  });

  test.each([
    'abc',
    'NaN',
    'Infinity',
    '-Infinity',
    '',
    '1e-5000',
    '1e1001',
    null,
    undefined,
    {},
    [],
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('%j は undefined を返し投げない', (v) => {
    expect(readStoredAmount(v)).toBeUndefined();
  });

  test('長い 16 進文字列は 1 秒以内に undefined', () => {
    const start = Date.now();
    expect(readStoredAmount('0x' + 'f'.repeat(200000))).toBeUndefined();
    expect(Date.now() - start).toBeLessThan(1000);
  });

  test('20 万桁の一般の書き方は長さを問わず読む', () => {
    const v = '1.' + '2'.repeat(200000);
    expect(readStoredAmount(v)?.toFixed(2)).toBe('1.22');
  });
});

describe('isAmountInputInvalid', () => {
  test('文字列以外は投げずに不正とする', () => {
    expect(isAmountInputInvalid(5000)).toBe(true);
    expect(isAmountInputInvalid({})).toBe(true);
  });
});

describe('保存済みの値を入力欄の文字列にする', () => {
  test.each([
    ['1200000', '1200000'],
    [1200000, '1200000'],
    [-1.5, '-1.5'],
    [Number.NaN, ''],
    [Number.POSITIVE_INFINITY, ''],
    [undefined, ''],
    [null, ''],
    [{}, ''],
    [true, ''],
  ])('%j は %j', (v, expected) => {
    expect(storedToInputText(v)).toBe(expected);
  });
});
