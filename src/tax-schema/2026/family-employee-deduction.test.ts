import { describe, expect, it } from 'vitest';
import { D } from '../../lib/decimal';
import type { PersonalDeductionFamilyEmployee } from '../../db/types';
import {
  familyEmployeeDeduction,
  familyEmployeeExclusion,
  isEligibleFamilyEmployee,
} from './family-employee-deduction';

function employee(
  overrides: Partial<PersonalDeductionFamilyEmployee>,
): PersonalDeductionFamilyEmployee {
  return {
    id: 'e1',
    name: '配偶者太郎',
    relation: 'other',
    age: 20,
    monthsWorked: 12,
    ...overrides,
  };
}

describe('familyEmployeeDeduction', () => {
  it('配偶者は86万円が定額の上限', () => {
    const result = familyEmployeeDeduction(2026, D(10_000_000), [employee({ relation: 'spouse' })]);
    expect(result.total.toString()).toBe('860000');
    expect(result.entries).toHaveLength(1);
  });

  it('その他の親族は50万円が定額の上限', () => {
    const result = familyEmployeeDeduction(2026, D(10_000_000), [employee({ relation: 'other' })]);
    expect(result.total.toString()).toBe('500000');
  });

  it('人ごとの上限が定額より低ければそちらを使う（配偶者1人・事業所得120万円）', () => {
    // 上限 = 1,200,000 / (1+1) = 600,000 < 860,000
    const result = familyEmployeeDeduction(2026, D(1_200_000), [employee({ relation: 'spouse' })]);
    expect(result.total.toString()).toBe('600000');
  });

  it('専従者2人なら除数が3になる', () => {
    // 上限 = 3,000,000 / (2+1) = 1,000,000。定額（86万・50万）の方が低いのでそちらが採用される
    const result = familyEmployeeDeduction(2026, D(3_000_000), [
      employee({ id: 'e1', relation: 'spouse' }),
      employee({ id: 'e2', relation: 'other' }),
    ]);
    expect(result.total.toString()).toBe('1360000');
  });

  it('14歳は年齢要件を満たさず除外', () => {
    const result = familyEmployeeDeduction(2026, D(10_000_000), [employee({ age: 14 })]);
    expect(result.total.toString()).toBe('0');
    expect(result.entries).toHaveLength(0);
  });

  it('従事月数がちょうど6か月は除外（6か月を超えることが要件）', () => {
    const result = familyEmployeeDeduction(2026, D(10_000_000), [employee({ monthsWorked: 6 })]);
    expect(result.total.toString()).toBe('0');
  });

  it('従事月数7か月は対象', () => {
    const result = familyEmployeeDeduction(2026, D(10_000_000), [employee({ monthsWorked: 7 })]);
    expect(result.total.toString()).toBe('500000');
  });

  it('所得金額が0なら控除も0', () => {
    const result = familyEmployeeDeduction(2026, D(0), [employee({})]);
    expect(result.total.toString()).toBe('0');
  });

  it('所得金額が負なら控除も0', () => {
    const result = familyEmployeeDeduction(2026, D(-100_000), [employee({})]);
    expect(result.total.toString()).toBe('0');
  });
});

describe('isEligibleFamilyEmployee', () => {
  it('15歳かつ7か月なら対象', () => {
    expect(isEligibleFamilyEmployee(employee({ age: 15, monthsWorked: 7 }))).toBe(true);
  });
});

describe('familyEmployeeExclusion', () => {
  it('配偶者を専従者にすると配偶者控除が構造的に除外対象になる', () => {
    const result = familyEmployeeExclusion([employee({ relation: 'spouse' })], []);
    expect(result.spouseExcluded).toBe(true);
  });

  it('氏名が一致する扶養親族は除外対象になる', () => {
    const result = familyEmployeeExclusion(
      [employee({ relation: 'other', name: '  山田花子  ' })],
      [{ id: 'd1', name: '山田花子' }],
    );
    expect(result.excludedDependentIds.has('d1')).toBe(true);
  });

  it('氏名が未入力どうしでは一致とみなさない', () => {
    const result = familyEmployeeExclusion(
      [employee({ relation: 'other', name: '  ' })],
      [{ id: 'd1', name: '' }],
    );
    expect(result.excludedDependentIds.has('d1')).toBe(false);
  });

  it('氏名が一致しない扶養親族は除外されない', () => {
    const result = familyEmployeeExclusion(
      [employee({ relation: 'other', name: '山田花子' })],
      [{ id: 'd1', name: '鈴木一郎' }],
    );
    expect(result.excludedDependentIds.has('d1')).toBe(false);
  });

  it('要件を満たさない専従者は除外を発生させない', () => {
    const result = familyEmployeeExclusion(
      [employee({ relation: 'spouse', age: 14 })],
      [{ id: 'd1', name: '配偶者太郎' }],
    );
    expect(result.spouseExcluded).toBe(false);
    expect(result.excludedDependentIds.size).toBe(0);
  });
});
