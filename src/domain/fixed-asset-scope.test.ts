import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { setSetting } from '../lib/settings';
import { toIndexable } from '../lib/decimal';
import {
  buildDepreciationInputs,
  computeDepreciation,
  generateYearEndDepreciation,
  InvalidBusinessDateError,
} from './depreciation';
import { generateDisposalEntry } from './asset-disposal';
import { findInvalidStoredAmounts } from './stored-value-checks';
import { m } from '../paraglide/messages';
import type { FixedAsset } from '../db/types';

function asset(overrides: Partial<FixedAsset> = {}): FixedAsset {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: '通常資産',
    acquisitionDate: '2026-03-01',
    acquisitionCost: '400000',
    usefulLifeYears: 4,
    depreciationMethod: 'straight-line',
    accountCode: '1510',
    ...overrides,
  };
}

function smallDeclining(overrides: Partial<FixedAsset> = {}): FixedAsset {
  return asset({
    name: '少額資産',
    acquisitionCost: '200000',
    usefulLifeYears: 25,
    depreciationMethod: 'small-asset-special',
    decliningBalanceElected: true,
    ...overrides,
  });
}
// 先に取得した 290,000 円 × 10 件で年 300 万円の枠をほぼ使い切る
function fillCap(year: number): FixedAsset[] {
  return Array.from({ length: 10 }, (_, i) =>
    asset({
      id: `cap-${i}`,
      name: `枠${i}`,
      acquisitionDate: `${year}-01-${String(i + 10).padStart(2, '0')}`,
      acquisitionCost: '290000',
      depreciationMethod: 'small-asset-special',
    }),
  );
}

async function entriesFor(id: string): Promise<number> {
  const all = await db.journalEntries.toArray();
  return all.filter((e) => e.description.includes(`#${id.slice(0, 8)}`)).length;
}

const opts = { allowFiledYear: true } as const;

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('少額特例＋定率法選択（R3）', () => {
  test('耐用年数 25 で特例に当たる資産は全額費用化し、ほかの資産と合わせて 2 件書く', async () => {
    await db.fixedAssets.bulkAdd([smallDeclining({ id: 's' }), asset({ id: 'n' })]);
    const r = await generateYearEndDepreciation(2026, opts);
    expect(r.created).toBe(2);
    const lines = await db.journalLines.toArray();
    expect(lines.some((l) => l.amount === '200000')).toBe(true);
  });

  test('枠を超えて落選すると率表に無い耐用年数になり、何も書かずに資産名を示す', async () => {
    await db.fixedAssets.bulkAdd([...fillCap(2026), smallDeclining({ id: 's' }), asset()]);
    await expect(generateYearEndDepreciation(2026, opts)).rejects.toThrow('少額資産');
    expect(await db.journalEntries.count()).toBe(0);
    const found = await findInvalidStoredAmounts(2026, 'income');
    expect(found.join(' ')).toContain('少額資産');
  });
});

describe('問題の影響範囲（R4・R5）', () => {
  test('リース月数の無いリース期間定額法の資産は、減価償却を止めて資産名を示す', async () => {
    await db.fixedAssets.bulkAdd([
      asset({ id: 'lease', name: 'リース機械', depreciationMethod: 'lease-period-straight-line' }),
      asset({ id: 'n' }),
    ]);
    await expect(generateYearEndDepreciation(2026, opts)).rejects.toThrow('リース機械');
    expect(await db.journalEntries.count()).toBe(0);
    await db.fixedAssets.update('lease', { leaseTermMonths: 36 });
    const r = await generateYearEndDepreciation(2026, opts);
    expect(r.created).toBe(2);
  });

  test('不動産の面積が -5 の資産があっても、ほかの資産の除却と減価償却は止めない', async () => {
    await db.fixedAssets.bulkAdd([
      asset({
        id: 're',
        name: '貸家',
        incomeType: 'realEstate',
        realEstateDetail: {
          propertyType: '住宅',
          isResidential: true,
          address: '東京',
          annualRent: '1200000',
          areaSqm: '-5',
        },
      }),
      asset({ id: 'n', acquisitionDate: '2024-01-01' }),
    ]);
    expect((await generateYearEndDepreciation(2026, opts)).created).toBe(2);
    await db.fixedAssets.update('n', { disposedDate: '2026-12-31', disposalType: 'scrap' });
    expect((await generateDisposalEntry('n', '1110', opts)).created).toBe(true);
    const found = await findInvalidStoredAmounts(2026, 'income');
    expect(found.join(' ')).toContain('貸家');
  });

  test('リース月数の無い資産があっても、ほかの資産の除却仕訳は作る', async () => {
    await db.fixedAssets.bulkAdd([
      asset({ id: 'lease', name: 'リース機械', depreciationMethod: 'lease-period-straight-line' }),
      asset({
        id: 'n',
        acquisitionDate: '2024-01-01',
        disposedDate: '2026-06-30',
        disposalType: 'scrap',
      }),
    ]);
    await db.journalEntries.add({
      id: 'ye',
      date: '2026-12-31',
      year: 2026,
      description: '減価償却 通常資産 #n',
      status: 'confirmed',
      source: 'manual',
      createdAt: 1,
      confirmedAt: 1,
    });
    expect(await generateDisposalEntry('n', '1110', opts)).toEqual({ created: true });
  });

  test('除却の編集で日付を消した資産（disposedDate: ""）は計算の問題にせず、両方に書く', async () => {
    await db.fixedAssets.bulkAdd([
      asset({ id: 'cleared', name: '戻した資産', disposedDate: '', disposalType: 'scrap' }),
      asset({ id: 'n' }),
    ]);
    expect((await generateYearEndDepreciation(2026, opts)).created).toBe(2);
    expect(await findInvalidStoredAmounts(2026, 'income')).toEqual([]);
  });

  test.each([
    ['serviceStartDate', { serviceStartDate: '' }],
    ['leaseContractDate', { leaseContractDate: '' }],
    ['acquisitionDate', { acquisitionDate: 20240101 as unknown as string }],
  ])('%s が日付として読めない資産は計算の問題として止める', async (_f, overrides) => {
    await db.fixedAssets.bulkAdd([asset({ id: 'bad', name: '日付の壊れた資産', ...overrides })]);
    await expect(generateYearEndDepreciation(2026, opts)).rejects.toThrow('日付の壊れた資産');
    expect(await db.journalEntries.count()).toBe(0);
  });

  test('一括償却の資産の取得日が数値、少額特例の取得日が "abc" でも例外で画面を壊さず止める', async () => {
    await db.fixedAssets.bulkAdd([
      asset({
        id: 'ls',
        name: '一括',
        depreciationMethod: 'lump-sum',
        acquisitionCost: '150000',
        lumpSumPoolId: 'business-2024',
        acquisitionDate: 20240101 as unknown as string,
      }),
      asset({
        id: 'sa',
        name: '少額',
        depreciationMethod: 'small-asset-special',
        acquisitionDate: 'abc',
      }),
    ]);
    const err = await generateYearEndDepreciation(2026, opts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('一括');
    expect((err as Error).message).toContain('少額');
  });
});

describe('ほかの資産を除いて計算しない（S2）', () => {
  const small = (id: string, date: string, extra: Partial<FixedAsset> = {}) =>
    asset({
      id,
      name: id,
      acquisitionDate: date,
      acquisitionCost: '290000',
      depreciationMethod: 'small-asset-special',
      ...extra,
    });

  test('少額特例の対象のうち 1 件に .xtx だけの問題があっても、3 件の適用状況は変わらない', () => {
    const clean = [small('a', '2024-01-01'), small('b', '2024-02-01'), small('c', '2024-03-01')];
    const withIssue = [
      clean[0]!,
      small('b', '2024-02-01', {
        incomeType: 'realEstate',
        realEstateDetail: {
          propertyType: '住宅',
          address: '東京',
          annualRent: '100',
          areaSqm: '-5',
        },
      }),
      clean[2]!,
    ];
    const a = buildDepreciationInputs(clean).statuses;
    const b = buildDepreciationInputs(withIssue).statuses;
    expect([...b.entries()]).toEqual([...a.entries()]);
  });

  test('一括償却の 3 件のうち中の 1 件に .xtx だけの問題があっても、各資産の按分額は変わらない', async () => {
    const pool = (id: string, cost: string, extra: Partial<FixedAsset> = {}) =>
      asset({
        id,
        name: id,
        acquisitionDate: '2026-01-01',
        acquisitionCost: cost,
        depreciationMethod: 'lump-sum',
        lumpSumPoolId: 'business-2026',
        ...extra,
      });
    const clean = [pool('p1', '100001'), pool('p2', '100001'), pool('p3', '100001')];
    const withIssue = [clean[0]!, pool('p2', '100001', { name: '' }), clean[2]!];
    const amounts = (assets: FixedAsset[]) => {
      const inputs = buildDepreciationInputs(assets);
      return assets.map(
        (a) => computeDepreciation(a, 2026, inputs.pools.get(a.id), inputs.statuses).amount,
      );
    };
    expect(amounts(withIssue)).toEqual(amounts(clean));
    await db.fixedAssets.bulkAdd(withIssue);
    expect((await generateYearEndDepreciation(2026, opts)).created).toBe(3);
  });
});

describe('仕訳の二重作成を防ぐ（S7）', () => {
  test('同じ年の減価償却を続けて 2 回走らせても 1 組だけ書く', async () => {
    await db.fixedAssets.bulkAdd([asset({ id: 'n' })]);
    const [a, b] = await Promise.all([
      generateYearEndDepreciation(2026, opts),
      generateYearEndDepreciation(2026, opts),
    ]);
    expect(a.created + b.created).toBe(1);
    expect(await entriesFor('n')).toBe(1);
  });

  test('同じ資産の除却を続けて 2 回走らせても 1 件だけ書く', async () => {
    await db.fixedAssets.bulkAdd([
      asset({
        id: 'n',
        acquisitionDate: '2024-01-01',
        disposedDate: '2026-01-31',
        disposalType: 'scrap',
      }),
    ]);
    await db.journalEntries.add({
      id: 'ye',
      date: '2026-12-31',
      year: 2026,
      description: '減価償却 通常資産 #n',
      status: 'confirmed',
      source: 'manual',
      createdAt: 1,
      confirmedAt: 1,
    });
    const results = await Promise.all([
      generateDisposalEntry('n', '1110', opts),
      generateDisposalEntry('n', '1110', opts),
    ]);
    expect(results.filter((r) => r.created).length).toBe(1);
    const disposals = (await db.journalEntries.toArray()).filter((e) =>
      e.description.includes('固定資産除却'),
    );
    expect(disposals.length).toBe(1);
  });
});

describe('除却・売却だけに効く問題（R14・R16）', () => {
  test('売却価格が 100 兆円以上の資産は、除却前に資産名を示して書かない', async () => {
    await db.fixedAssets.bulkAdd([
      asset({
        id: 'big',
        name: '高すぎる売却',
        acquisitionDate: '2024-01-01',
        disposedDate: '2026-01-31',
        disposalType: 'sale',
        salePrice: '100000000000000',
      }),
    ]);
    await expect(generateDisposalEntry('big', '1110', opts)).rejects.toThrow('高すぎる売却');
    expect(await db.journalEntries.count()).toBe(0);
  });

  test('除却・売却の区分が読めない資産は、除却で資産名を示して止める', async () => {
    await db.fixedAssets.bulkAdd([
      asset({
        id: 'x',
        name: '区分の壊れた資産',
        acquisitionDate: '2024-01-01',
        disposedDate: '2026-01-31',
        disposalType: 'x' as never,
      }),
    ]);
    await expect(generateDisposalEntry('x', '1110', opts)).rejects.toThrow('区分の壊れた資産');
    expect(await db.journalEntries.count()).toBe(0);
  });
});

describe('開業日・廃業日が日付として読めないとき（R23）', () => {
  test.each([
    ['businessStartDate', '2026-13-01'],
    ['businessCloseDate', '2026/12/31'],
  ] as const)('%s %j は減価償却・.xtx を止めて理由を示す', async (key, value) => {
    await setSetting(key, value);
    await db.fixedAssets.bulkAdd([asset({ id: 'n' })]);
    const { loadBusinessDates } = await import('../lib/settings');
    const dates = await loadBusinessDates();
    await expect(generateYearEndDepreciation(2026, { ...opts, ...dates })).rejects.toThrow(
      InvalidBusinessDateError,
    );
    expect(await db.journalEntries.count()).toBe(0);
    const found = await findInvalidStoredAmounts(2026, 'income');
    expect(found.join(' ')).toContain(value);
  });

  test('開業日が未設定で、最も古い開業仕訳の日付が "2026-13-01" なら減価償却を止める', async () => {
    await db.fixedAssets.bulkAdd([asset({ id: 'n' })]);
    await db.journalEntries.add({
      id: 'op',
      date: '2026-13-01',
      year: 2026,
      description: '開業',
      status: 'confirmed',
      source: 'opening',
      createdAt: 1,
      confirmedAt: 1,
    });
    await db.journalLines.add({
      id: 'opl',
      entryId: 'op',
      side: 'debit',
      accountCode: '1110',
      amount: '1',
      amountIndexed: toIndexable('1'),
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
    });
    await expect(generateYearEndDepreciation(2026, opts)).rejects.toThrow(
      m.business_date_invalid_opening_entry({ value: '2026-13-01' }),
    );
  });
});

describe('.xtx の前の検査（R10・R16・S12）', () => {
  test.each([
    ['取得価額の長い 16 進', { acquisitionCost: '0x' + 'f'.repeat(65) }],
    ['名前なし', { name: '' }],
    [
      '物件の種類なし',
      {
        incomeType: 'realEstate' as const,
        realEstateDetail: { propertyType: '', address: '東京', annualRent: '100' },
      },
    ],
    [
      '年租金なし',
      {
        incomeType: 'realEstate' as const,
        realEstateDetail: { propertyType: '住宅', address: '東京' } as never,
      },
    ],
    ['明細が文字列', { incomeType: 'realEstate' as const, realEstateDetail: 'x' as never }],
    [
      '賃借人名が数値',
      {
        incomeType: 'realEstate' as const,
        realEstateDetail: {
          propertyType: '住宅',
          address: '東京',
          annualRent: '100',
          tenantName: 1 as never,
        },
      },
    ],
    [
      '年租金 1e15',
      {
        incomeType: 'realEstate' as const,
        realEstateDetail: { propertyType: '住宅', address: '東京', annualRent: '1e15' },
      },
    ],
  ])('%s の資産は .xtx の前に資産の名前付きで示す', async (_label, overrides) => {
    await db.fixedAssets.bulkAdd([asset({ id: 'bad12345', name: '問題の資産', ...overrides })]);
    const found = (await findInvalidStoredAmounts(2026, 'income')).join(' ');
    expect(found).toMatch(/問題の資産|#bad12345/);
  });

  test('取得価額 0x3e8 の資産は .xtx の前の検査を通る', async () => {
    await db.fixedAssets.bulkAdd([asset({ acquisitionCost: '0x3e8' })]);
    expect(await findInvalidStoredAmounts(2026, 'income')).toEqual([]);
  });
});
