import { describe, expect, test } from 'vitest';
import { D } from '../lib/decimal';
import { interimFilingObligation } from './interim-filing';

describe('interimFilingObligation（中間申告義務判定）', () => {
  test('前年確定税額48万円以下：義務なし', () => {
    const result = interimFilingObligation(2026, D('480000'));
    expect(result.installmentCount).toBe(0);
    expect(result.installments).toEqual([]);
  });

  test('48万円超400万円以下：年1回、前年額の6/12、1/1-6/30・期限8/31', () => {
    const result = interimFilingObligation(2026, D('1000000'));
    expect(result.installmentCount).toBe(1);
    expect(result.installments).toHaveLength(1);
    const i = result.installments[0]!;
    expect(i.start).toBe('2026-01-01');
    expect(i.end).toBe('2026-06-30');
    expect(i.dueDate).toBe('2026-08-31');
    // 1,000,000 / 2 = 500,000（すでに百円単位）
    expect(i.amount.national).toBe('500000');
    // 500,000 × 22/78 = 141,025.6… → 百円未満切り捨て = 141,000
    expect(i.amount.local).toBe('141000');
  });

  test('400万円超4800万円以下：年3回、前年額の3/12、四半期ごと', () => {
    const result = interimFilingObligation(2026, D('8000000'));
    expect(result.installmentCount).toBe(3);
    expect(result.installments).toHaveLength(3);
    const [q1, q2, q3] = result.installments as [
      (typeof result.installments)[0],
      (typeof result.installments)[0],
      (typeof result.installments)[0],
    ];
    expect(q1.start).toBe('2026-01-01');
    expect(q1.end).toBe('2026-03-31');
    expect(q1.dueDate).toBe('2026-05-31');
    expect(q2.start).toBe('2026-04-01');
    expect(q2.end).toBe('2026-06-30');
    expect(q2.dueDate).toBe('2026-08-31');
    expect(q3.start).toBe('2026-07-01');
    expect(q3.end).toBe('2026-09-30');
    expect(q3.dueDate).toBe('2026-11-30');
    // 8,000,000 / 4 = 2,000,000
    expect(q1.amount.national).toBe('2000000');
  });

  test('4800万円超：年11回、前年額の1/12、毎月・期限は各月末の2ヶ月後', () => {
    const result = interimFilingObligation(2026, D('96000000'));
    expect(result.installmentCount).toBe(11);
    expect(result.installments).toHaveLength(11);
    const jan = result.installments[0]!;
    expect(jan.start).toBe('2026-01-01');
    expect(jan.end).toBe('2026-01-31');
    expect(jan.dueDate).toBe('2026-03-31');
    // 2月（28日、2026年は平年）
    const feb = result.installments[1]!;
    expect(feb.start).toBe('2026-02-01');
    expect(feb.end).toBe('2026-02-28');
    expect(feb.dueDate).toBe('2026-04-30');
    const nov = result.installments[10]!;
    expect(nov.start).toBe('2026-11-01');
    expect(nov.end).toBe('2026-11-30');
    expect(nov.dueDate).toBe('2027-01-31');
    // 96,000,000 / 12 = 8,000,000
    expect(jan.amount.national).toBe('8000000');
  });

  test('境界値：48万円ちょうどは義務なし、48万円超400万円ちょうどは年1回', () => {
    expect(interimFilingObligation(2026, D('480001')).installmentCount).toBe(1);
    expect(interimFilingObligation(2026, D('4000000')).installmentCount).toBe(1);
    expect(interimFilingObligation(2026, D('4000001')).installmentCount).toBe(3);
    expect(interimFilingObligation(2026, D('48000000')).installmentCount).toBe(3);
    expect(interimFilingObligation(2026, D('48000001')).installmentCount).toBe(11);
  });
});
