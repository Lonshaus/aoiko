import { describe, expect, test } from 'vitest'
import { JournalValidationError, validateLines } from './journal'
import { toIndexable } from '../lib/decimal'
import type { JournalLine } from '../db/types'

function line(
  side: 'debit' | 'credit',
  amount: string,
  overrides: Partial<JournalLine> = {}
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
  }
}

describe('validateLines', () => {
  test('accepts a balanced two-line entry', () => {
    expect(() =>
      validateLines([line('debit', '5000'), line('credit', '5000')])
    ).not.toThrow()
  })

  test('accepts a balanced multi-line entry', () => {
    expect(() =>
      validateLines([
        line('debit', '4500'),
        line('debit', '500'),
        line('credit', '5000'),
      ])
    ).not.toThrow()
  })

  test('accepts cross-balance N debits to N credits', () => {
    expect(() =>
      validateLines([
        line('debit', '3000'),
        line('debit', '2000'),
        line('credit', '4000'),
        line('credit', '1000'),
      ])
    ).not.toThrow()
  })

  test('rejects empty', () => {
    const err = expectThrow(() => validateLines([]))
    expect(err.code).toBe('no-lines')
  })

  test('rejects missing one side', () => {
    const err = expectThrow(() =>
      validateLines([line('debit', '5000'), line('debit', '5000')])
    )
    expect(err.code).toBe('one-sided')
  })

  test('rejects unbalanced', () => {
    const err = expectThrow(() =>
      validateLines([line('debit', '5000'), line('credit', '4000')])
    )
    expect(err.code).toBe('unbalanced')
    expect(err.message).toMatch(/5000.*4000/)
  })

  test('rejects negative amount', () => {
    const err = expectThrow(() =>
      validateLines([
        { ...line('debit', '5000'), amount: '-1000' },
        line('credit', '5000'),
      ])
    )
    expect(err.code).toBe('negative-amount')
  })
})

function expectThrow(fn: () => void): JournalValidationError {
  try {
    fn()
  } catch (e) {
    if (e instanceof JournalValidationError) return e
    throw new Error(`expected JournalValidationError, got ${e}`)
  }
  throw new Error('expected to throw')
}