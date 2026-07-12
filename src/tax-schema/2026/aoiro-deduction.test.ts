import { describe, expect, test } from 'vitest';
import { D } from '../../lib/decimal';
import { aoiroDeductionAmount, aoiroDeductionLimit } from './aoiro-deduction';

describe('aoiroDeductionLimit', () => {
  test('令和8年分（2026）：電子=65万・複式=55万・簡易=10万・なし=0', () => {
    expect(aoiroDeductionLimit(2026, 'electronic').toString()).toBe('650000');
    expect(aoiroDeductionLimit(2026, 'doubleEntry').toString()).toBe('550000');
    expect(aoiroDeductionLimit(2026, 'simple').toString()).toBe('100000');
    expect(aoiroDeductionLimit(2026, 'none').toString()).toBe('0');
  });

  test('令和9年分（2027）以降：電子は75万に引き上げ', () => {
    expect(aoiroDeductionLimit(2027, 'electronic').toString()).toBe('750000');
    expect(aoiroDeductionLimit(2026, 'electronic').toString()).toBe('650000');
  });
});

describe('aoiroDeductionAmount', () => {
  test('控除前所得が限度額以上なら限度額を全額控除', () => {
    expect(aoiroDeductionAmount(2026, 'electronic', D(5000000)).toString()).toBe('650000');
  });

  test('控除前所得が限度額未満なら控除前所得が上限', () => {
    expect(aoiroDeductionAmount(2026, 'electronic', D(400000)).toString()).toBe('400000');
  });

  test('赤字（控除前所得が0以下）なら控除0', () => {
    expect(aoiroDeductionAmount(2026, 'electronic', D(-100000)).toString()).toBe('0');
    expect(aoiroDeductionAmount(2026, 'simple', D(0)).toString()).toBe('0');
  });
});
