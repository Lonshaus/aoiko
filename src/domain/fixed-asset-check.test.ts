import { describe, expect, test } from 'vitest';
import {
  affectsSmallAssetCap,
  describeInvalidFixedAssets,
  fixedAssetIssueScope,
  validateFixedAsset,
} from './fixed-asset-check';
import type { FixedAsset } from '../db/types';

function asset(overrides: Partial<FixedAsset> = {}): FixedAsset {
  return {
    id: 'a1',
    name: 'テスト PC',
    acquisitionDate: '2026-01-01',
    acquisitionCost: '300000',
    usefulLifeYears: 4,
    depreciationMethod: 'straight-line',
    accountCode: '1510',
    ...overrides,
  };
}

describe('validateFixedAsset', () => {
  test('正常な資産と、旧い書き方の 1e3 の取得価額は問題なし', () => {
    expect(validateFixedAsset(asset())).toEqual([]);
    expect(validateFixedAsset(asset({ acquisitionCost: '1e3' }))).toEqual([]);
    expect(
      validateFixedAsset(
        asset({ depreciationMethod: 'lease-period-straight-line', leaseTermMonths: 60 }),
      ),
    ).toEqual([]);
  });

  test.each([
    ['acquisitionCost', { acquisitionCost: 'abc' }],
    ['acquisitionCost', { acquisitionCost: '-5' }],
    ['acquisitionCost', { acquisitionCost: '1e-5000' }],
    ['conversionBasis', { conversionBasis: 'abc' }],
    [
      'residualGuaranteeAmount',
      { residualGuaranteeAmount: 'abc', leaseContractDate: '2026-01-01' },
    ],
    ['salePrice', { disposalType: 'sale' as const, salePrice: 'abc' }],
    ['saleExpenses', { saleExpenses: '-1' }],
    [
      'annualRent',
      {
        incomeType: 'realEstate' as const,
        realEstateDetail: { propertyType: '貸家', address: '東京', annualRent: 'abc' },
      },
    ],
  ])('%s の読めない値・負の値は amount の問題', (field, overrides) => {
    const issues = validateFixedAsset(asset(overrides));
    expect(issues).toContainEqual({ kind: 'amount', field });
  });

  test('取得価額・業務供用時の未償却残高が 1e14 以上なら過大', () => {
    expect(validateFixedAsset(asset({ acquisitionCost: '100000000000000' }))).toEqual([
      { kind: 'too-large', field: 'acquisitionCost' },
    ]);
    expect(validateFixedAsset(asset({ conversionBasis: '1e15' }))).toEqual([
      { kind: 'too-large', field: 'conversionBasis' },
    ]);
  });

  test.each([
    { usefulLifeYears: 'abc' as unknown as number },
    { usefulLifeYears: 0 },
    { usefulLifeYears: 2.5 },
    { depreciationMethod: 'declining-balance' as const, usefulLifeYears: 25 },
    { depreciationMethod: 'old-declining-balance' as const, usefulLifeYears: 101 },
    { depreciationMethod: 'old-straight-line' as const, usefulLifeYears: 1 },
    { depreciationMethod: 'old-straight-line' as const, assetCategory: 9 as const },
    {
      depreciationMethod: 'small-asset-special' as const,
      decliningBalanceElected: true,
      usefulLifeYears: 51,
    },
  ])('耐用年数が率表に無い・整数でない %j は useful-life の問題', (overrides) => {
    expect(validateFixedAsset(asset(overrides))).toContainEqual({ kind: 'useful-life' });
  });

  test('使用可能期間 1 年未満は率表を使わないので耐用年数の範囲を問わない', () => {
    expect(
      validateFixedAsset(
        asset({
          depreciationMethod: 'declining-balance',
          usefulLifeYears: 30,
          usableLifeUnderOneYear: true,
        }),
      ),
    ).toEqual([]);
  });

  test.each([undefined, 0, 1.5, '12' as unknown as number])(
    'リース期間定額法のリース期間 %j は lease-term の問題',
    (leaseTermMonths) => {
      const a = asset({ depreciationMethod: 'lease-period-straight-line' });
      if (leaseTermMonths !== undefined) {
        a.leaseTermMonths = leaseTermMonths;
      }
      expect(validateFixedAsset(a)).toContainEqual({ kind: 'lease-term' });
    },
  );

  test('未知の償却方法は method の問題', () => {
    expect(
      validateFixedAsset(
        asset({ depreciationMethod: 'unknown' as FixedAsset['depreciationMethod'] }),
      ),
    ).toContainEqual({ kind: 'method' });
  });

  test('理由は資産名付きで並ぶ', () => {
    const a = asset({ name: '壊れた機械', acquisitionCost: 'abc' });
    expect(describeInvalidFixedAssets([{ asset: a, issues: validateFixedAsset(a) }])).toContain(
      '壊れた機械',
    );
  });
});

describe('validateFixedAsset（影響範囲と追加の検査）', () => {
  test.each([1, 21, 25, 50])(
    '少額特例＋定率法選択の耐用年数 %i は問題なし（落選時に計算できるかは償却時に判定する）',
    (life) => {
      expect(
        validateFixedAsset(
          asset({
            depreciationMethod: 'small-asset-special',
            decliningBalanceElected: true,
            usefulLifeYears: life,
          }),
        ),
      ).toEqual([]);
    },
  );

  test('売却価格が 100 兆円以上なら過大で、除却・売却だけに効く', () => {
    const issues = validateFixedAsset(
      asset({ disposalType: 'sale', salePrice: '100000000000000' }),
    );
    expect(issues).toEqual([{ kind: 'too-large', field: 'salePrice' }]);
    expect(fixedAssetIssueScope(issues[0]!)).toBe('disposal');
  });

  test('除却・売却の区分は未指定なら除却として問題なし、未知の値は問題', () => {
    expect(validateFixedAsset(asset({ disposedDate: '2026-06-30' }))).toEqual([]);
    expect(
      validateFixedAsset(asset({ disposedDate: '2026-06-30', disposalType: 'x' as never })),
    ).toEqual([{ kind: 'disposal-type' }]);
  });

  test('名前・物件の種類・年額の賃貸料が無い、明細の形が違うものは .xtx だけの問題', () => {
    const re = (detail: unknown) =>
      validateFixedAsset(asset({ incomeType: 'realEstate', realEstateDetail: detail as never }));
    expect(validateFixedAsset(asset({ name: '' }))).toEqual([{ kind: 'name' }]);
    expect(re({ propertyType: '', address: '東京', annualRent: '1' })).toEqual([
      { kind: 'property', field: 'propertyType' },
    ]);
    expect(re({ propertyType: '住宅', address: '東京' })).toEqual([
      { kind: 'amount', field: 'annualRent' },
    ]);
    expect(re('x')).toEqual([{ kind: 'property', field: 'detail' }]);
    expect(re({ propertyType: '住宅', address: '東京', annualRent: '1', tenantName: 1 })).toEqual([
      { kind: 'property', field: 'tenantName' },
    ]);
    expect(re({ propertyType: '住宅', address: '東京', annualRent: '1e15' })).toEqual([
      { kind: 'xtx-too-large', field: 'annualRent' },
    ]);
    for (const issue of [
      ...re('x'),
      ...re({ propertyType: '住宅', address: '東京', annualRent: '1e15' }),
      { kind: 'name' as const },
    ]) {
      expect(fixedAssetIssueScope(issue)).toBe('output');
    }
  });

  test('不動産所得でない資産の明細は .xtx に載らないので形を問わない', () => {
    expect(validateFixedAsset(asset({ realEstateDetail: 'x' as never }))).toEqual([]);
  });

  test.each([
    [{ disposedDate: '' }, []],
    [{ disposedDate: null as never }, []],
    [{ disposedDate: '2026-02-30' }, [{ kind: 'date', field: 'disposedDate' }]],
    [{ serviceStartDate: '' }, [{ kind: 'date', field: 'serviceStartDate' }]],
    [{ leaseContractDate: '' }, [{ kind: 'date', field: 'leaseContractDate' }]],
    [{ acquisitionDate: 20240101 as never }, [{ kind: 'date', field: 'acquisitionDate' }]],
    [{ acquisitionDate: 'abc' }, [{ kind: 'date', field: 'acquisitionDate' }]],
  ])('日付 %j の問題は %j', (overrides, expected) => {
    expect(validateFixedAsset(asset(overrides as Partial<FixedAsset>))).toEqual(expected);
  });

  test('少額特例の枠を読む欄の問題だけが、ほかの資産の除却を止める', () => {
    expect(affectsSmallAssetCap({ kind: 'amount', field: 'acquisitionCost' })).toBe(true);
    expect(affectsSmallAssetCap({ kind: 'date', field: 'serviceStartDate' })).toBe(true);
    expect(affectsSmallAssetCap({ kind: 'method' })).toBe(true);
    expect(affectsSmallAssetCap({ kind: 'lease-term' })).toBe(false);
    expect(affectsSmallAssetCap({ kind: 'useful-life' })).toBe(false);
    expect(affectsSmallAssetCap({ kind: 'amount', field: 'conversionBasis' })).toBe(false);
    expect(affectsSmallAssetCap({ kind: 'amount', field: 'areaSqm' })).toBe(false);
  });
});
