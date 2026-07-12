import { describe, expect, test } from 'vitest';
import { expandHomeOffice, HomeOfficeRatioError, type SplittableLine } from './home-office';

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
  test('pass-through when ratio is empty', () => {
    const r = expandHomeOffice([line({ amount: '5000' })]);
    expect(r).toHaveLength(1);
    expect(r[0]?.amount).toBe('5000');
  });

  test('pass-through when ratio is 1', () => {
    const r = expandHomeOffice([line({ amount: '5000', homeOfficeRatio: '1' })]);
    expect(r).toHaveLength(1);
    expect(r[0]?.accountCode).toBe('5260');
    expect(r[0]?.amount).toBe('5000');
  });

  test('splits 100,000 at 0.30 into 30,000 + 70,000', () => {
    const r = expandHomeOffice([line({ amount: '100000', homeOfficeRatio: '0.30' })]);
    expect(r).toHaveLength(2);
    const business = r.find((x) => x.accountCode === '5260');
    const drawing = r.find((x) => x.accountCode === '1610');
    expect(business?.amount).toBe('30000');
    expect(drawing?.amount).toBe('70000');
  });

  test('consolidates multiple personal portions into single drawing line', () => {
    const r = expandHomeOffice([
      line({ id: 'a', accountCode: '5260', amount: '100000', homeOfficeRatio: '0.30' }),
      line({ id: 'b', accountCode: '5150', amount: '5000', homeOfficeRatio: '0.40' }),
    ]);
    expect(r).toHaveLength(3);
    const drawing = r.find((x) => x.accountCode === '1610');
    expect(drawing?.amount).toBe('73000'); // 70000 + 3000
  });

  test('preserves credit-side lines unchanged', () => {
    const r = expandHomeOffice([
      line({ side: 'credit', accountCode: '1130', amount: '100000', homeOfficeRatio: '0.30' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]?.side).toBe('credit');
    expect(r[0]?.amount).toBe('100000');
  });

  test('rounding: 100,001 at 0.30 splits into 30,000 + 70,001 (no lost yen)', () => {
    const r = expandHomeOffice([line({ amount: '100001', homeOfficeRatio: '0.30' })]);
    const business = r.find((x) => x.accountCode === '5260');
    const drawing = r.find((x) => x.accountCode === '1610');
    expect(business?.amount).toBe('30000');
    expect(drawing?.amount).toBe('70001');
  });

  test('rejects ratio outside [0, 1]', () => {
    expect(() => expandHomeOffice([line({ homeOfficeRatio: '1.5' })])).toThrow(
      HomeOfficeRatioError,
    );
    expect(() => expandHomeOffice([line({ homeOfficeRatio: '-0.1' })])).toThrow(
      HomeOfficeRatioError,
    );
  });

  test('rejects ratio of exactly 0', () => {
    expect(() => expandHomeOffice([line({ homeOfficeRatio: '0' })])).toThrow(/0% の行は意味がない/);
  });

  test('rejects malformed ratio', () => {
    expect(() => expandHomeOffice([line({ homeOfficeRatio: 'abc' })])).toThrow(
      HomeOfficeRatioError,
    );
  });

  test('zero amount with ratio: pass-through', () => {
    const r = expandHomeOffice([line({ amount: '0', homeOfficeRatio: '0.30' })]);
    expect(r).toHaveLength(1);
    expect(r[0]?.amount).toBe('0');
  });

  test('preserves taxRate / taxIncluded on business portion', () => {
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

  test('drawing portion is tax-exempt (taxRate 0)', () => {
    const r = expandHomeOffice([line({ amount: '10000', homeOfficeRatio: '0.50', taxRate: 0.1 })]);
    const drawing = r.find((x) => x.accountCode === '1610');
    expect(drawing?.taxRate).toBe(0);
  });
});
