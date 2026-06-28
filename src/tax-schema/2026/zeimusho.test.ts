import { describe, expect, test } from 'vitest';
import { isValidZeimushoCode, ZEIMUSHO_CODES } from './zeimusho';

describe('税務署コード', () => {
  test('xsd 由来のコードは 557 件・全て 5 桁', () => {
    expect(ZEIMUSHO_CODES.length).toBe(557);
    expect(ZEIMUSHO_CODES.every((c) => /^\d{5}$/.test(c))).toBe(true);
  });

  test('enumeration に存在するコードは妥当', () => {
    expect(isValidZeimushoCode(ZEIMUSHO_CODES[0]!)).toBe(true);
    expect(isValidZeimushoCode('01101')).toBe(true);
  });

  test('存在しない・桁数違いは不正', () => {
    expect(isValidZeimushoCode('99999')).toBe(false);
    expect(isValidZeimushoCode('1234')).toBe(false);
    expect(isValidZeimushoCode('')).toBe(false);
  });
});