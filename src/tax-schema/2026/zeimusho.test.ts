import { describe, expect, test } from 'vitest';
import {
  displayZeimusho,
  isValidZeimushoCode,
  isZeimushoUnresolved,
  nextConfirmedZeimusho,
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

describe('入力欄の確定値', () => {
  const KOJIMACHI = { code: '01101', name: '麹町' };

  test('表記はコードだけの時と署名がある時で分かれる', () => {
    expect(displayZeimusho('01101', '麹町')).toBe('麹町（01101）');
    expect(displayZeimusho('01101', '')).toBe('01101');
    expect(displayZeimusho('', '麹町')).toBe('');
  });

  test('打っている途中では確定値を捨てない', () => {
    // 既定表示「麹町（01101）」から 1 文字消しただけの状態。ここで捨てると
    // 設定済みの署が触るだけで失われる。
    expect(nextConfirmedZeimusho('麹町（01101', KOJIMACHI)).toEqual(KOJIMACHI);
    expect(nextConfirmedZeimusho('麹', KOJIMACHI)).toEqual(KOJIMACHI);
    expect(nextConfirmedZeimusho('0110', KOJIMACHI)).toEqual(KOJIMACHI);
  });

  test('欄を空にしたときだけ確定値を捨てる', () => {
    expect(nextConfirmedZeimusho('', KOJIMACHI)).toEqual({ code: '', name: '' });
    expect(nextConfirmedZeimusho('   ', KOJIMACHI)).toEqual({ code: '', name: '' });
  });

  test('有効な 5 桁を打ち切ったら確定する', () => {
    expect(nextConfirmedZeimusho('01103', KOJIMACHI)).toEqual({ code: '01103', name: '神田' });
    // 存在しないコードは確定させない。前の確定値も残す。
    expect(nextConfirmedZeimusho('99999', KOJIMACHI)).toEqual(KOJIMACHI);
  });

  test('欄と確定値が食い違っていれば未解決', () => {
    expect(isZeimushoUnresolved('麹町（01101）', KOJIMACHI)).toBe(false);
    expect(isZeimushoUnresolved('01101', KOJIMACHI)).toBe(false);
    expect(isZeimushoUnresolved('麹町（0110', KOJIMACHI)).toBe(true);
    // 空欄は「指定しない」であって未解決ではない。確定値も同時に空になる。
    expect(isZeimushoUnresolved('', KOJIMACHI)).toBe(false);
    // 確定していないのに文字が残っている状態。
    expect(isZeimushoUnresolved('麹町', { code: '', name: '' })).toBe(true);
  });

  test('署名の無いコードでも往復する', () => {
    const noName = { code: '00001', name: '' };
    expect(displayZeimusho(noName.code, noName.name)).toBe('00001');
    expect(isZeimushoUnresolved('00001', noName)).toBe(false);
  });
});
