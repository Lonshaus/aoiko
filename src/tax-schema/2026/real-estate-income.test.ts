import { describe, expect, test } from 'vitest';
import { D, type Decimal } from '../../lib/decimal';
import type { PLReport } from '../../domain/reports';
import type { AoiroDeductionKind } from './aoiro-deduction';
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

function plWithBadDebtReserve(netIncome: string, amount: string): PLReport {
  return {
    year: 2026,
    revenue: [],
    expense: [
      {
        accountCode: '5410',
        accountName: '貸倒引当金繰入額（不動産）',
        category: 'expense',
        amount,
        displayOrder: 1410,
      },
    ],
    totalRevenue: '0',
    totalExpense: amount,
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

  test('非事業的規模なら青色でも貸倒引当金繰入額（不動産）を加算し直す（52条1項は事業を営むことが要件）', () => {
    const pl = plWithBadDebtReserve('2700000', '100000');
    expect(realEstatePreDeductionIncome(pl, false).toString()).toBe('2800000');
  });

  test('事業的規模なら白色でも貸倒引当金繰入額（不動産）は必要経費のまま（個別評価は青白共通）', () => {
    const pl = plWithBadDebtReserve('2700000', '100000');
    expect(realEstatePreDeductionIncome(pl, true, 'white').toString()).toBe('2700000');
  });

  test('事業的規模なら青色でも貸倒引当金繰入額（不動産）は必要経費のまま', () => {
    const pl = plWithBadDebtReserve('2700000', '100000');
    expect(realEstatePreDeductionIncome(pl, true).toString()).toBe('2700000');
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

describe('allocateAoiroDeduction：令和9年分以後の措法25条の2第2項・現金主義', () => {
  test('事業的規模でない不動産所得のみの者は前々年分の不動産収入が1,000万円超でも10万のまま', () => {
    const r = allocateAoiroDeduction(2027, 'simple', false, false, D(0), D(3000000), {
      priorPriorRealEstateRevenue: D(15_000_000),
    });
    expect(r.totalDeduction.toString()).toBe('100000');
    expect(r.realEstateDeduction.toString()).toBe('100000');
  });

  test('電子区分でも事業所得が無く事業的規模でなければ10万に降格し、不動産収入は判定に使わない', () => {
    const r = allocateAoiroDeduction(2027, 'electronic', false, false, D(0), D(3000000), {
      priorPriorRealEstateRevenue: D(15_000_000),
    });
    expect(r.totalDeduction.toString()).toBe('100000');
  });

  test('事業的規模の不動産所得で前々年分の不動産収入が1,000万円超なら0', () => {
    const r = allocateAoiroDeduction(2027, 'simple', false, true, D(0), D(3000000), {
      priorPriorRealEstateRevenue: D(15_000_000),
    });
    expect(r.totalDeduction.toString()).toBe('0');
    expect(r.realEstateDeduction.toString()).toBe('0');
    expect(r.businessDeduction.toString()).toBe('0');
  });

  test('事業所得の前々年分総収入金額が1,000万円超なら、事業的規模でない不動産所得と合わせて0', () => {
    const r = allocateAoiroDeduction(2027, 'simple', true, false, D(2000000), D(3000000), {
      priorPriorBusinessRevenue: D(10_000_001),
      priorPriorRealEstateRevenue: D(500_000),
    });
    expect(r.totalDeduction.toString()).toBe('0');
  });

  test('現金主義の適用者は電子区分でも10万', () => {
    const r = allocateAoiroDeduction(2027, 'electronic', true, true, D(2000000), D(3000000), {
      cashBasis: true,
    });
    expect(r.totalDeduction.toString()).toBe('100000');
    expect(r.realEstateDeduction.toString()).toBe('100000');
  });

  test('D1-F11(1)：赤字の事業を正規の簿記で経営していれば2項の影響を受けず10万（simple なら0）', () => {
    const doubleEntry = allocateAoiroDeduction(
      2027,
      'doubleEntry',
      true,
      false,
      D(-100000),
      D(3000000),
      { priorPriorBusinessRevenue: D(12_000_000) },
    );
    expect(doubleEntry.totalDeduction.toString()).toBe('100000');
    const simple = allocateAoiroDeduction(2027, 'simple', true, false, D(-100000), D(3000000), {
      priorPriorBusinessRevenue: D(12_000_000),
    });
    expect(simple.totalDeduction.toString()).toBe('0');
  });
});
// 修正前の aoiroDeductionLimit・allocateAoiroDeduction を写したもの（新しい入力が未設定のときの比較基準）。
function legacyLimit(year: number, kind: AoiroDeductionKind): Decimal {
  switch (kind) {
    case 'electronic':
      return D(year >= 2027 ? 750000 : 650000);
    case 'eTax':
      return D(650000);
    case 'doubleEntry':
      return D(550000);
    case 'simple':
      return D(100000);
    case 'none':
      return D(0);
  }
}

function legacyAllocate(
  year: number,
  kind: AoiroDeductionKind,
  hasBusinessIncome: boolean,
  businessScale: boolean,
  businessPre: Decimal,
  realEstatePre: Decimal,
): string[] {
  const effectiveKind = combinedAoiroDeductionKind(kind, hasBusinessIncome, businessScale);
  const limit = legacyLimit(year, effectiveKind);
  const businessBase = businessPre.greaterThan(0) ? businessPre : D(0);
  const realEstateBase = realEstatePre.greaterThan(0) ? realEstatePre : D(0);
  const combinedBase = businessBase.plus(realEstateBase);
  const total = combinedBase.lessThan(limit) ? combinedBase : limit;
  const realEstate = total.lessThan(realEstateBase) ? total : realEstateBase;
  return [realEstate.toString(), total.minus(realEstate).toString(), total.toString()];
}

describe('allocateAoiroDeduction：新しい入力が未設定なら修正前と同じ結果', () => {
  const kinds: AoiroDeductionKind[] = ['electronic', 'doubleEntry', 'simple', 'none'];
  const incomes = [D(-100000), D(0), D(80000), D(400000), D(900000)];
  test('令和8年分は全区分、令和9年分は条文で55万の段が消えた複式簿記を除く全区分', () => {
    for (const year of [2026, 2027]) {
      for (const kind of kinds) {
        if (year >= 2027 && kind === 'doubleEntry') {
          continue;
        }
        for (const hasBusinessIncome of [true, false]) {
          for (const businessScale of [true, false]) {
            for (const businessPre of incomes) {
              for (const realEstatePre of incomes) {
                const expected = legacyAllocate(
                  year,
                  kind,
                  hasBusinessIncome,
                  businessScale,
                  businessPre,
                  realEstatePre,
                );
                for (const r of [
                  allocateAoiroDeduction(
                    year,
                    kind,
                    hasBusinessIncome,
                    businessScale,
                    businessPre,
                    realEstatePre,
                  ),
                  allocateAoiroDeduction(
                    year,
                    kind,
                    hasBusinessIncome,
                    businessScale,
                    businessPre,
                    realEstatePre,
                    {},
                  ),
                ]) {
                  expect([
                    r.realEstateDeduction.toString(),
                    r.businessDeduction.toString(),
                    r.totalDeduction.toString(),
                  ]).toEqual(expected);
                }
              }
            }
          }
        }
      }
    }
  });

  test('令和9年分の複式簿記＋紙申告は10万（修正前は55万）', () => {
    const r = allocateAoiroDeduction(2027, 'doubleEntry', true, true, D(900000), D(400000));
    expect(r.totalDeduction.toString()).toBe('100000');
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
      undefined,
    );
    expect(r.businessIncome.toString()).toBe('2350000');
    expect(r.combinedIncome.toString()).toBe('2350000');
  });

  test('両方黒字なら共有枠を配分し、combinedIncome は両方の合計から控除額を引いたもの', () => {
    const pl = plWith('400000');
    const input: RealEstateIncomeCtx = { businessScale: true };
    const r = computeCombinedBusinessRealEstateIncome(
      2026,
      'electronic',
      true,
      D(500000),
      pl,
      input,
    );
    expect(r.realEstateIncomeAfterDeduction.toString()).toBe('0');
    expect(r.businessIncome.toString()).toBe('250000');
    expect(r.combinedIncome.toString()).toBe('250000');
  });

  test('不動産所得が赤字で土地利子額が無ければ全額が事業所得と損益通算できる', () => {
    const pl = plWith('-200000');
    const input: RealEstateIncomeCtx = { businessScale: true };
    const r = computeCombinedBusinessRealEstateIncome(
      2026,
      'electronic',
      true,
      D(500000),
      pl,
      input,
    );
    expect(r.realEstateIncomeAfterDeduction.toString()).toBe('-200000');
    expect(r.realEstateOffsettable.toString()).toBe('-200000');
    expect(r.combinedIncome.toString()).toBe('-200000');
  });

  test('不動産所得が赤字で土地利子額があれば、その分だけ損益通算から除外される', () => {
    const pl = plWith('-200000');
    const input: RealEstateIncomeCtx = { businessScale: true, landLoanInterestAmount: D(50000) };
    const r = computeCombinedBusinessRealEstateIncome(
      2026,
      'electronic',
      true,
      D(500000),
      pl,
      input,
    );
    expect(r.realEstateOffsettable.toString()).toBe('-150000');
    expect(r.combinedIncome.toString()).toBe('-150000');
  });
});

describe('computeCombinedBusinessRealEstateIncome：青色申告特別控除のオプション', () => {
  test('オプション未設定と空オブジェクトは同じ結果', () => {
    const pl = plWith('400000');
    const input: RealEstateIncomeCtx = { businessScale: true };
    const a = computeCombinedBusinessRealEstateIncome(
      2026,
      'electronic',
      true,
      D(900000),
      pl,
      input,
    );
    const b = computeCombinedBusinessRealEstateIncome(
      2026,
      'electronic',
      true,
      D(900000),
      pl,
      input,
      {},
    );
    expect(b.combinedIncome.toString()).toBe(a.combinedIncome.toString());
    expect(b.businessIncome.toString()).toBe(a.businessIncome.toString());
  });

  test('不動産所得が無い場合も前々年分の事業収入1,000万円超で0（令和9年分・簡易簿記）', () => {
    const r = computeCombinedBusinessRealEstateIncome(
      2027,
      'simple',
      true,
      D(900000),
      undefined,
      undefined,
      { priorPriorBusinessRevenue: D(12_000_000) },
    );
    expect(r.businessIncome.toString()).toBe('900000');
  });

  test('不動産所得がある場合もオプションが配分に渡る', () => {
    const pl = plWith('400000');
    const input: RealEstateIncomeCtx = { businessScale: true };
    const r = computeCombinedBusinessRealEstateIncome(
      2027,
      'electronic',
      true,
      D(900000),
      pl,
      input,
      { cashBasis: true },
    );
    expect(r.realEstateIncomeAfterDeduction.toString()).toBe('300000');
    expect(r.businessIncome.toString()).toBe('900000');
  });
});
