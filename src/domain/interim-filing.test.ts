import { describe, expect, test } from 'vitest';
import { D, Decimal } from '../lib/decimal';
import { filingBreakdown } from './consumption-tax';
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

  test('4800万円超：年11回、前年額の1/12、1〜3月分は5月31日・4月分以降は各月末の2ヶ月後', () => {
    const result = interimFilingObligation(2026, D('96000000'));
    expect(result.installmentCount).toBe(11);
    expect(result.installments).toHaveLength(11);
    // 個人事業者は1月分〜3月分が揃って5月31日（措令46条の2第1項の読み替え）
    const jan = result.installments[0]!;
    expect(jan.start).toBe('2026-01-01');
    expect(jan.end).toBe('2026-01-31');
    expect(jan.dueDate).toBe('2026-05-31');
    // 2月（28日、2026年は平年）
    const feb = result.installments[1]!;
    expect(feb.start).toBe('2026-02-01');
    expect(feb.end).toBe('2026-02-28');
    expect(feb.dueDate).toBe('2026-05-31');
    const mar = result.installments[2]!;
    expect(mar.dueDate).toBe('2026-05-31');
    // 4月分から通常の「末日の翌日から2ヶ月以内」に戻る
    const apr = result.installments[3]!;
    expect(apr.start).toBe('2026-04-01');
    expect(apr.dueDate).toBe('2026-06-30');
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
// 改修前の判定（年額 48万／400万／4800万、前年額 ÷2／÷4／÷12）をそのまま写した比較用
function legacyObligation(prior: Decimal): { count: number; amounts: string[] } {
  const part = (divisor: number) =>
    filingBreakdown(prior.dividedBy(divisor).toDecimalPlaces(0, Decimal.ROUND_DOWN)).national;
  if (prior.lessThanOrEqualTo(480_000)) {
    return { count: 0, amounts: [] };
  }
  if (prior.lessThanOrEqualTo(4_000_000)) {
    return { count: 1, amounts: [part(2)] };
  }
  if (prior.lessThanOrEqualTo(48_000_000)) {
    return { count: 3, amounts: [part(4), part(4), part(4)] };
  }
  return { count: 11, amounts: Array.from({ length: 11 }, () => part(12)) };
}

describe('interimFilingObligation：直前の課税期間の月数（消法42条）', () => {
  const samples = [
    '0',
    '1',
    '479999',
    '480000',
    '480001',
    '999999',
    '1000000',
    '1000001',
    '1000003',
    '3999999',
    '4000000',
    '4000001',
    '4000003',
    '47999999',
    '48000000',
    '48000001',
    '96000005',
  ];

  test('R1：月数を渡さないときは改修前の判定・金額と完全に同じ', () => {
    for (const v of samples) {
      const prior = D(v);
      const current = interimFilingObligation(2026, prior);
      const legacy = legacyObligation(prior);
      expect(current.installmentCount, v).toBe(legacy.count);
      expect(
        current.installments.map((i) => i.amount.national),
        v,
      ).toEqual(legacy.amounts);
      expect(current.voluntary, v).toBeUndefined();
      expect(interimFilingObligation(2026, prior, 12)).toEqual(current);
    }
  });

  test('F1：直前の課税期間7か月・確定税額3,500,000は ÷7 で判定し、年額4,000,000以下の旧判定と異なる', () => {
    const prior = D('3500000');
    const legacy = legacyObligation(prior);
    expect(legacy.count).toBe(1);
    const result = interimFilingObligation(2026, prior, 7);
    // 月割 500,000 × 3 = 1,500,000 が 100万円超のため三月中間申告
    expect(result.installmentCount).toBe(3);
    expect(result.installments[0]!.amount.national).toBe('1500000');
    expect(result.installmentCount).not.toBe(legacy.count);
  });

  test('月数が短いと24万円の基準も月割で見る（6か月・確定税額240,001）', () => {
    expect(interimFilingObligation(2026, D('240000'), 6).installmentCount).toBe(0);
    const r = interimFilingObligation(2026, D('240001'), 6);
    expect(r.installmentCount).toBe(1);
    // 240,001 ÷ 6 × 6 = 240,001 → 百円未満切捨て
    expect(r.installments[0]!.amount.national).toBe('240000');
  });
});

describe('interimFilingObligation：任意の中間申告（消法42条8項・11項、44条）', () => {
  test('R4：届出の入力が無ければ24万円以下の義務なしは従来どおり', () => {
    expect(interimFilingObligation(2026, D('300000'))).toEqual({
      installmentCount: 0,
      installments: [],
    });
    expect(interimFilingObligation(2026, D('300000'), 12, {})).toEqual({
      installmentCount: 0,
      installments: [],
    });
    expect(
      interimFilingObligation(2026, D('300000'), 12, {
        interimVoluntaryFiled: false,
        interimVoluntaryLapsed: false,
      }),
    ).toEqual({ installmentCount: 0, installments: [] });
  });

  test('届出をしていれば24万円以下でも六月中間申告を1回、みなし申告の対象外として返す', () => {
    const r = interimFilingObligation(2026, D('300000'), 12, { interimVoluntaryFiled: true });
    expect(r.installmentCount).toBe(1);
    expect(r.voluntary).toBe(true);
    expect(r.installments[0]!.start).toBe('2026-01-01');
    expect(r.installments[0]!.end).toBe('2026-06-30');
    expect(r.installments[0]!.dueDate).toBe('2026-08-31');
    expect(r.installments[0]!.amount.national).toBe('150000');
  });

  test('F13：期限までに出さなかった後は以後の年度で任意の中間申告は生じず、みなし申告も生じない', () => {
    for (const year of [2026, 2027, 2028]) {
      const r = interimFilingObligation(year, D('300000'), 12, {
        interimVoluntaryFiled: true,
        interimVoluntaryLapsed: true,
      });
      expect(r.installmentCount).toBe(0);
      expect(r.installments).toEqual([]);
      expect(r.voluntary).toBeUndefined();
    }
  });

  test('24万円超の義務がある年は届出の有無と関係なく通常の中間申告（みなし申告の対象）', () => {
    const r = interimFilingObligation(2026, D('1000000'), 12, {
      interimVoluntaryFiled: true,
      interimVoluntaryLapsed: true,
    });
    expect(r.installmentCount).toBe(1);
    expect(r.voluntary).toBeUndefined();
  });
});
