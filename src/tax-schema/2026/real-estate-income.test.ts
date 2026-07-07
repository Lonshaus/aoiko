import { describe, expect, test } from 'vitest';
import { D } from '../../lib/decimal';
import type { PLReport } from '../../domain/reports';
import {
  allocateAoiroDeduction,
  combinedAoiroDeductionKind,
  computeCombinedBusinessRealEstateIncome,
  offsettableRealEstateLoss,
  realEstatePreDeductionIncome,
  type RealEstateIncomeCtx,
} from './real-estate-income';

function plWith(netIncome: string, senjushaAmount?: string): PLReport {
  return {
    year: 2026,
    revenue: [],
    expense: senjushaAmount
      ? [
          {
            accountCode: '5380',
            accountName: '専従者給与（不動産）',
            category: 'expense',
            amount: senjushaAmount,
            displayOrder: 1380,
          },
        ]
      : [],
    totalRevenue: '0',
    totalExpense: senjushaAmount ?? '0',
    netIncome,
    entryCount: 0,
  };
}

describe('realEstatePreDeductionIncome', () => {
  test('事業的規模なら専従者給与（不動産）はそのまま控除済みで返す', () => {
    const pl = plWith('300000', '200000');
    expect(realEstatePreDeductionIncome(pl, true).toString()).toBe('300000');
  });

  test('事業的規模でなければ専従者給与（不動産）を全額不算入で加算し直す', () => {
    const pl = plWith('300000', '200000');
    expect(realEstatePreDeductionIncome(pl, false).toString()).toBe('500000');
  });

  test('専従者給与（不動産）が無ければ businessScale に関わらず変わらない', () => {
    const pl = plWith('300000');
    expect(realEstatePreDeductionIncome(pl, false).toString()).toBe('300000');
  });
});

describe('combinedAoiroDeductionKind', () => {
  test('事業所得があれば事業的規模に関わらずそのまま', () => {
    expect(combinedAoiroDeductionKind('electronic', true, false)).toBe('electronic');
  });

  test('事業的規模なら事業所得が無くてもそのまま', () => {
    expect(combinedAoiroDeductionKind('electronic', false, true)).toBe('electronic');
  });

  test('事業所得も事業的規模も無ければ simple に降格', () => {
    expect(combinedAoiroDeductionKind('electronic', false, false)).toBe('simple');
    expect(combinedAoiroDeductionKind('doubleEntry', false, false)).toBe('simple');
  });

  test('元々 simple/none ならそのまま（降格しない）', () => {
    expect(combinedAoiroDeductionKind('simple', false, false)).toBe('simple');
    expect(combinedAoiroDeductionKind('none', false, false)).toBe('none');
  });
});

describe('allocateAoiroDeduction', () => {
  test('両方黒字・合計が限度額未満なら全額控除、不動産所得から優先配分', () => {
    const r = allocateAoiroDeduction(2026, 'electronic', true, true, D(300000), D(200000));
    expect(r.realEstateDeduction.toString()).toBe('200000');
    expect(r.businessDeduction.toString()).toBe('300000');
    expect(r.totalDeduction.toString()).toBe('500000');
  });

  test('合計が限度額を超えるなら限度額で頭打ち、不動産所得から優先控除', () => {
    const r = allocateAoiroDeduction(2026, 'electronic', true, true, D(500000), D(400000));
    expect(r.totalDeduction.toString()).toBe('650000');
    expect(r.realEstateDeduction.toString()).toBe('400000');
    expect(r.businessDeduction.toString()).toBe('250000');
  });

  test('不動産所得が赤字（0扱い）なら全額事業所得から控除', () => {
    const r = allocateAoiroDeduction(2026, 'electronic', true, true, D(500000), D(-100000));
    expect(r.realEstateDeduction.toString()).toBe('0');
    expect(r.businessDeduction.toString()).toBe('500000');
  });

  test('事業所得が無く事業的規模でもない不動産所得のみなら10万が上限', () => {
    const r = allocateAoiroDeduction(2026, 'electronic', false, false, D(0), D(500000));
    expect(r.totalDeduction.toString()).toBe('100000');
    expect(r.realEstateDeduction.toString()).toBe('100000');
  });

  test('事業所得が単独で電子区分を満たせば、事業的規模でない不動産所得にも65万枠が及ぶ', () => {
    const r = allocateAoiroDeduction(2026, 'electronic', true, false, D(500000), D(400000));
    expect(r.totalDeduction.toString()).toBe('650000');
    expect(r.realEstateDeduction.toString()).toBe('400000');
    expect(r.businessDeduction.toString()).toBe('250000');
  });
});

describe('offsettableRealEstateLoss', () => {
  test('黒字ならそのまま返す', () => {
    expect(offsettableRealEstateLoss(D(100000), D(50000)).toString()).toBe('100000');
  });

  test('赤字が土地利子額以下なら全額が損益通算不可（0）', () => {
    expect(offsettableRealEstateLoss(D(-30000), D(50000)).toString()).toBe('0');
  });

  test('赤字が土地利子額を上回るなら、超過分だけ損益通算できる', () => {
    expect(offsettableRealEstateLoss(D(-100000), D(30000)).toString()).toBe('-70000');
  });

  test('土地利子額が0なら赤字全額が損益通算できる', () => {
    expect(offsettableRealEstateLoss(D(-100000), D(0)).toString()).toBe('-100000');
  });
});

describe('computeCombinedBusinessRealEstateIncome', () => {
  test('不動産所得が無ければ既存の単一事業所得の計算と一致する', () => {
    const r = computeCombinedBusinessRealEstateIncome(
      2026,
      'electronic',
      true,
      D(3000000),
      undefined,
      undefined
    );
    expect(r.businessIncome.toString()).toBe('2350000');
    expect(r.combinedIncome.toString()).toBe('2350000');
  });

  test('両方黒字なら共有枠を配分し、combinedIncome は両方の合計から控除額を引いたもの', () => {
    const pl = plWith('400000');
    const input: RealEstateIncomeCtx = { businessScale: true };
    const r = computeCombinedBusinessRealEstateIncome(2026, 'electronic', true, D(500000), pl, input);
    expect(r.realEstateIncomeAfterDeduction.toString()).toBe('0');
    expect(r.businessIncome.toString()).toBe('250000');
    expect(r.combinedIncome.toString()).toBe('250000');
  });

  test('不動産所得が赤字で土地利子額が無ければ全額が事業所得と損益通算できる', () => {
    const pl = plWith('-200000');
    const input: RealEstateIncomeCtx = { businessScale: true };
    const r = computeCombinedBusinessRealEstateIncome(2026, 'electronic', true, D(500000), pl, input);
    expect(r.realEstateIncomeAfterDeduction.toString()).toBe('-200000');
    expect(r.realEstateOffsettable.toString()).toBe('-200000');
    expect(r.combinedIncome.toString()).toBe('-200000');
  });

  test('不動産所得が赤字で土地利子額があれば、その分だけ損益通算から除外される', () => {
    const pl = plWith('-200000');
    const input: RealEstateIncomeCtx = { businessScale: true, landLoanInterestAmount: D(50000) };
    const r = computeCombinedBusinessRealEstateIncome(2026, 'electronic', true, D(500000), pl, input);
    expect(r.realEstateOffsettable.toString()).toBe('-150000');
    expect(r.combinedIncome.toString()).toBe('-150000');
  });
});