import { describe, expect, test } from 'vitest';
import { JournalValidationError, validateLines } from './journal';
import { toIndexable } from '../lib/decimal';
import type { JournalLine } from '../db/types';

function line(
  side: 'debit' | 'credit',
  amount: string,
  overrides: Partial<JournalLine> = {},
): JournalLine {
  return {
    id: `line-${Math.random()}`,
    entryId: 'entry-1',
    side,
    accountCode: '5130',
    amount,
    amountIndexed: toIndexable(amount),
    taxRate: 0,
    taxIncluded: true,
    invoiceCompliant: false,
    ...overrides,
  };
}

describe('validateLines', () => {
  test('貸借一致した 2 行の仕訳を受け付ける', () => {
    expect(() => validateLines([line('debit', '5000'), line('credit', '5000')])).not.toThrow();
  });

  test('貸借一致した複数行の仕訳を受け付ける', () => {
    expect(() =>
      validateLines([line('debit', '4500'), line('debit', '500'), line('credit', '5000')]),
    ).not.toThrow();
  });

  test('借方 N 行・貸方 N 行の貸借一致を受け付ける', () => {
    expect(() =>
      validateLines([
        line('debit', '3000'),
        line('debit', '2000'),
        line('credit', '4000'),
        line('credit', '1000'),
      ]),
    ).not.toThrow();
  });

  test('空の仕訳は拒否する', () => {
    const err = expectThrow(() => validateLines([]));
    expect(err.code).toBe('no-lines');
  });

  test('片側が欠けた仕訳は拒否する', () => {
    const err = expectThrow(() => validateLines([line('debit', '5000'), line('debit', '5000')]));
    expect(err.code).toBe('one-sided');
  });

  test('貸借不一致は拒否する', () => {
    const err = expectThrow(() => validateLines([line('debit', '5000'), line('credit', '4000')]));
    expect(err.code).toBe('unbalanced');
    expect(err.message).toMatch(/5000.*4000/);
  });

  test('負の金額は拒否する', () => {
    const err = expectThrow(() =>
      validateLines([{ ...line('debit', '5000'), amount: '-1000' }, line('credit', '5000')]),
    );
    expect(err.code).toBe('negative-amount');
  });

  test('全行 0 円の仕訳は拒否する', () => {
    const err = expectThrow(() => validateLines([line('debit', '0'), line('credit', '0')]));
    expect(err.code).toBe('zero-amount');
  });
});

function expectThrow(fn: () => void): JournalValidationError {
  try {
    fn();
  } catch (e) {
    if (e instanceof JournalValidationError) return e;
    throw new Error(`expected JournalValidationError, got ${e}`);
  }
  throw new Error('expected to throw');
}
