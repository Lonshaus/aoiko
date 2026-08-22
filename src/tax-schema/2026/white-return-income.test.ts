import { describe, expect, test } from 'vitest';
import { whiteReturnAdjustedNetIncome } from './white-return-income';
import type { PLReport } from '../../domain/reports';

function pl(overrides: Partial<PLReport> = {}): PLReport {
  return {
    year: 2026,
    revenue: [],
    expense: [],
    totalRevenue: '0',
    totalExpense: '0',
    netIncome: '0',
    entryCount: 0,
    ...overrides,
  };
}

describe('whiteReturnAdjustedNetIncome', () => {
  test('除外科目が無ければ netIncome をそのまま返す', () => {
    const result = whiteReturnAdjustedNetIncome(pl({ netIncome: '4552000' }));
    expect(result.toString()).toBe('4552000');
  });

  test('専従者給与・貸倒引当金繰入額（一括評価）の分を所得へ加算し直す', () => {
    const result = whiteReturnAdjustedNetIncome(
      pl({
        netIncome: '3690000',
        expense: [
          {
            accountCode: '5250',
            accountName: '専従者給与',
            category: 'expense',
            amount: '860000',
            displayOrder: 250,
          },
          {
            accountCode: '5260',
            accountName: '貸倒引当金繰入額（一括評価）',
            category: 'expense',
            amount: '30000',
            displayOrder: 260,
          },
          {
            accountCode: '5130',
            accountName: '水道光熱費',
            category: 'expense',
            amount: '120000',
            displayOrder: 130,
          },
        ],
      }),
    );
    // 3690000 + 860000 + 30000 = 4580000（水道光熱費は通常どおり控除済みのまま）
    expect(result.toString()).toBe('4580000');
  });

  test('貸倒引当金繰入額（個別評価）は白色でも通常の必要経費のまま（所得税法52条1項に青色限定は無い）', () => {
    const result = whiteReturnAdjustedNetIncome(
      pl({
        netIncome: '3690000',
        expense: [
          {
            accountCode: '5811',
            accountName: '貸倒引当金繰入額（個別評価）',
            category: 'expense',
            amount: '30000',
            displayOrder: 811,
          },
        ],
      }),
    );
    expect(result.toString()).toBe('3690000');
  });

  test('貸倒引当金繰入額（一括評価）は52条2項が青色限定のため白色では加算し直す', () => {
    const result = whiteReturnAdjustedNetIncome(
      pl({
        netIncome: '3690000',
        expense: [
          {
            accountCode: '5810',
            accountName: '貸倒引当金繰入額（一括評価）',
            category: 'expense',
            amount: '30000',
            displayOrder: 810,
          },
        ],
      }),
    );
    expect(result.toString()).toBe('3720000');
  });
});
