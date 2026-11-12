import { describe, expect, test } from 'vitest';
import { describeConversionBasisOverCost } from './fixed-asset-check';
import { m } from '../paraglide/messages';
import type { FixedAsset } from '../db/types';

function asset(overrides: Partial<FixedAsset> & { id: string }): FixedAsset {
  return {
    name: '転用PC',
    acquisitionDate: '2026-01-01',
    acquisitionCost: '300000',
    usefulLifeYears: 4,
    depreciationMethod: 'straight-line',
    accountCode: '1510',
    ...overrides,
  };
}

describe('describeConversionBasisOverCost', () => {
  test('業務供用時の未償却残高が取得価額を超える資産だけを名前で並べ、読めない値は飛ばす', () => {
    const text = describeConversionBasisOverCost([
      asset({ id: 'a', name: '超えるPC', conversionBasis: '344820' }),
      asset({ id: 'b', name: '同額PC', conversionBasis: '300000' }),
      asset({ id: 'c', name: '通常PC' }),
      asset({ id: 'd', name: '読めないPC', conversionBasis: 'abc' }),
      asset({ id: 'e', name: '取得価額が読めないPC', acquisitionCost: 'x', conversionBasis: '1' }),
      asset({ id: 'f', name: '超える2', acquisitionCost: '100', conversionBasis: '100.5' }),
    ]);
    expect(text).toBe(
      m.settings_asset_conversion_basis_exceeds_cost({ names: '超えるPC、超える2' }),
    );
  });

  test('該当が無ければ空文字', () => {
    expect(describeConversionBasisOverCost([asset({ id: 'a', conversionBasis: '1' })])).toBe('');
  });
});
