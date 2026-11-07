import { describe, expect, test } from 'vitest';
import { buildCsv, neutralizeFormula, parseCsv } from './csv';

describe('parseCsv', () => {
  test('basic two-row CSV', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  test('strips BOM', () => {
    expect(parseCsv('﻿a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  test('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  test('quoted fields with embedded comma', () => {
    expect(parseCsv('"hello, world",x\n"foo","bar"')).toEqual([
      ['hello, world', 'x'],
      ['foo', 'bar'],
    ]);
  });

  test('escaped double quote inside quoted field', () => {
    expect(parseCsv('"He said ""hi""",ok')).toEqual([['He said "hi"', 'ok']]);
  });

  test('empty fields preserved', () => {
    expect(parseCsv('a,,c\n,2,')).toEqual([
      ['a', '', 'c'],
      ['', '2', ''],
    ]);
  });

  test('skips fully blank lines', () => {
    expect(parseCsv('a,b\n\n1,2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  test('returns empty for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });

  test('handles trailing newline gracefully', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  test('handles missing final newline', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('neutralizeFormula', () => {
  test.each([
    '=1+1',
    '+1',
    '-1',
    '@SUM(1)',
    '＝1',
    '＋1',
    '－1',
    '＠x',
    '−1',
    '\tabc',
    '\rabc',
    '\nabc',
  ])('prefixes %j with a single quote', (value) => {
    expect(neutralizeFormula(value)).toBe(`'${value}`);
  });

  test.each([' =1+1', '　＝1', '\u00a0@x'])(
    'prefixes %j without trimming the leading whitespace',
    (value) => {
      expect(neutralizeFormula(value)).toBe(`'${value}`);
    },
  );

  test.each(['テスト仕訳', ' abc', '1000', '2026-05-01', '2026/05/01', '', 'a=b'])(
    'leaves %j unchanged',
    (value) => {
      expect(neutralizeFormula(value)).toBe(value);
    },
  );
});

describe('buildCsv', () => {
  test('neutralizes before quoting', () => {
    expect(buildCsv([['=A1,B1']])).toBe(`"'=A1,B1"\r\n`);
  });

  test.each([
    ['a;b', '"a;b"\r\n'],
    ['a\tb', '"a\tb"\r\n'],
  ])('quotes %j', (value, expected) => {
    expect(buildCsv([[value]])).toBe(expected);
  });
});
