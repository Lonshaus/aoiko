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

  test('専従者給与・貸倒引当金繰入額の分を所得へ加算し直す', () => {
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
            accountName: '貸倒引当金繰入額',
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
      })
    );
    // 3690000 + 860000 + 30000 = 4580000（水道光熱費は通常どおり控除済みのまま）
    expect(result.toString()).toBe('4580000');
  });
});