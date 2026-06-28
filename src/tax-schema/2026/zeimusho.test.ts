import { describe, expect, test } from 'vitest';
import {
  isValidZeimushoCode,
  searchZeimusho,
  zeimushoName,
  ZEIMUSHO_CODES,
  ZEIMUSHO_MASTER,
} from './zeimusho';

describe('税務署コード', () => {
  test('xsd 由来のコードは 557 件・全て 5 桁', () => {
    expect(ZEIMUSHO_CODES.length).toBe(557);
    expect(ZEIMUSHO_CODES.every((c) => /^\d{5}$/.test(c))).toBe(true);
  });

  test('master の大半に署名が付く（検索用）', () => {
    const named = ZEIMUSHO_MASTER.filter((e) => e.name).length;
    expect(named).toBeGreaterThan(500);
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

  test('コード→署名（01101=麹町・01197=武蔵野）', () => {
    expect(zeimushoName('01101')).toBe('麹町');
    expect(zeimushoName('01197')).toBe('武蔵野');
    expect(zeimushoName('99999')).toBeUndefined();
  });

  test('署名・コードで検索できる', () => {
    expect(searchZeimusho('武蔵野').some((e) => e.code === '01197')).toBe(true);
    expect(searchZeimusho('01101').some((e) => e.name === '麹町')).toBe(true);
    expect(searchZeimusho('')).toEqual([]);
  });
});