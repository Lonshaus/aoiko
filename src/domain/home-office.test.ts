import { describe, expect, test } from 'vitest';
import {
  expandHomeOffice,
  isValidDefaultRatio,
  HomeOfficeRatioError,
  type SplittableLine,
} from './home-office';

function line(overrides: Partial<SplittableLine> = {}): SplittableLine {
  return {
    id: 'l1',
    side: 'debit',
    accountCode: '5260',
    subAccountId: '',
    amount: '100000',
    taxRate: 0.1,
    taxIncluded: true,
    homeOfficeRatio: '',
    ...overrides,
  };
}

describe('expandHomeOffice', () => {
  test('按分率が空ならそのまま返す', () => {
    const r = expandHomeOffice([line({ amount: '5000' })]);
    expect(r).toHaveLength(1);
    expect(r[0]?.amount).toBe('5000');
  });

  test('按分率が 1 ならそのまま返す', () => {
    const r = expandHomeOffice([line({ amount: '5000', homeOfficeRatio: '1' })]);
    expect(r).toHaveLength(1);
    expect(r[0]?.accountCode).toBe('5260');
    expect(r[0]?.amount).toBe('5000');
  });

  test('100,000 を 0.30 で 30,000 + 70,000 に分ける', () => {
    const r = expandHomeOffice([line({ amount: '100000', homeOfficeRatio: '0.30' })]);
    expect(r).toHaveLength(2);
    const business = r.find((x) => x.accountCode === '5260');
    const drawing = r.find((x) => x.accountCode === '1610');
    expect(business?.amount).toBe('30000');
    expect(drawing?.amount).toBe('70000');
  });

  test('複数の私用分を 1 行の事業主貸にまとめる', () => {
    const r = expandHomeOffice([
      line({ id: 'a', accountCode: '5260', amount: '100000', homeOfficeRatio: '0.30' }),
      line({ id: 'b', accountCode: '5150', amount: '5000', homeOfficeRatio: '0.40' }),
    ]);
    expect(r).toHaveLength(3);
    const drawing = r.find((x) => x.accountCode === '1610');
    expect(drawing?.amount).toBe('73000'); // 70000 + 3000
  });

  test('貸方の行は変えない', () => {
    const r = expandHomeOffice([
      line({ side: 'credit', accountCode: '1130', amount: '100000', homeOfficeRatio: '0.30' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]?.side).toBe('credit');
    expect(r[0]?.amount).toBe('100000');
  });

  test('端数処理：100,001 を 0.30 で 30,000 + 70,001 に分ける（1 円も失わない）', () => {
    const r = expandHomeOffice([line({ amount: '100001', homeOfficeRatio: '0.30' })]);
    const business = r.find((x) => x.accountCode === '5260');
    const drawing = r.find((x) => x.accountCode === '1610');
    expect(business?.amount).toBe('30000');
    expect(drawing?.amount).toBe('70001');
  });

  test('[0, 1] の範囲外の按分率は拒否する', () => {
    expect(() => expandHomeOffice([line({ homeOfficeRatio: '1.5' })])).toThrow(
      HomeOfficeRatioError,
    );
    expect(() => expandHomeOffice([line({ homeOfficeRatio: '-0.1' })])).toThrow(
      HomeOfficeRatioError,
    );
  });

  test('按分率がちょうど 0 なら拒否する', () => {
    expect(() => expandHomeOffice([line({ homeOfficeRatio: '0' })])).toThrow(/0% の行は意味がない/);
  });

  test('形式の不正な按分率は拒否する', () => {
    expect(() => expandHomeOffice([line({ homeOfficeRatio: 'abc' })])).toThrow(
      HomeOfficeRatioError,
    );
  });

  test('金額 0 で按分率ありならそのまま返す', () => {
    const r = expandHomeOffice([line({ amount: '0', homeOfficeRatio: '0.30' })]);
    expect(r).toHaveLength(1);
    expect(r[0]?.amount).toBe('0');
  });

  test('事業分は taxRate / taxIncluded を保つ', () => {
    const r = expandHomeOffice([
      line({
        amount: '10000',
        homeOfficeRatio: '0.50',
        taxRate: 0.08,
        taxIncluded: false,
      }),
    ]);
    const business = r.find((x) => x.accountCode === '5260');
    expect(business?.taxRate).toBe(0.08);
    expect(business?.taxIncluded).toBe(false);
  });

  test('事業主貸の部分は不課税（taxRate 0）', () => {
    const r = expandHomeOffice([line({ amount: '10000', homeOfficeRatio: '0.50', taxRate: 0.1 })]);
    const drawing = r.find((x) => x.accountCode === '1610');
    expect(drawing?.taxRate).toBe(0);
  });
});

describe('isValidDefaultRatio', () => {
  test('0 < 比率 < 1 のみ有効', () => {
    expect(isValidDefaultRatio('0.30')).toBe(true);
    expect(isValidDefaultRatio('0.01')).toBe(true);
    expect(isValidDefaultRatio('0.99')).toBe(true);
  });

  test('空文字・1（適用しない）・0・範囲外・非数値は無効', () => {
    expect(isValidDefaultRatio('')).toBe(false);
    expect(isValidDefaultRatio('1')).toBe(false);
    expect(isValidDefaultRatio('1.0')).toBe(false);
    expect(isValidDefaultRatio('1.000')).toBe(false);
    expect(isValidDefaultRatio('0')).toBe(false);
    expect(isValidDefaultRatio('-0.3')).toBe(false);
    expect(isValidDefaultRatio('1.5')).toBe(false);
    expect(isValidDefaultRatio('abc')).toBe(false);
  });
});
