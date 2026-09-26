import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { newId } from '../lib/id';
import { D } from '../lib/decimal';
import {
  aggregateTransferIncome,
  buildDisposalLines,
  disposalBookValue,
  estimateTransferIncome,
  generateDisposalEntry,
  transferIncomeByTerm,
} from './asset-disposal';
import { computeDepreciation, generateYearEndDepreciation } from './depreciation';
import type { FixedAsset } from '../db/types';

function asset(overrides: Partial<FixedAsset> = {}): FixedAsset {
  return {
    id: newId(),
    name: 'テスト什器',
    acquisitionDate: '2022-01-01',
    acquisitionCost: '1000000',
    usefulLifeYears: 4,
    depreciationMethod: 'straight-line',
    accountCode: '1510',
    ...overrides,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('buildDisposalLines（除却）', () => {
  test('帳簿価額が残っている場合、除却損＋累計償却＋資産で貸借一致する', () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'scrap' });
    const lines = buildDisposalLines(a);
    const { accumulatedEnd, bookValueEnd } = disposalBookValue(a);
    expect(D(bookValueEnd).greaterThan(0)).toBe(true);
    const debit = lines.filter((l) => l.side === 'debit').reduce((s, l) => s.plus(l.amount), D(0));
    const credit = lines
      .filter((l) => l.side === 'credit')
      .reduce((s, l) => s.plus(l.amount), D(0));
    expect(debit.toString()).toBe(credit.toString());
    expect(lines).toContainEqual({ side: 'debit', accountCode: '5280', amount: bookValueEnd });
    expect(lines).toContainEqual({ side: 'debit', accountCode: '1520', amount: accumulatedEnd });
    expect(lines).toContainEqual({ side: 'credit', accountCode: '1510', amount: '1000000' });
  });

  test('少額特例で帳簿価額 0 なら除却損は計上しない', () => {
    const a = asset({
      depreciationMethod: 'small-asset-special',
      acquisitionCost: '150000',
      disposedDate: '2027-01-01',
      disposalType: 'scrap',
    });
    const { bookValueEnd } = disposalBookValue(a);
    expect(bookValueEnd).toBe('0');
    const lines = buildDisposalLines(a);
    expect(lines.some((l) => l.accountCode === '5280')).toBe(false);
  });

  test('disposedDate 未設定なら例外', () => {
    expect(() => buildDisposalLines(asset())).toThrow();
  });

  test('一括償却資産の除却は仕訳明細なし（3 年均等償却を継続する）', () => {
    const a = asset({
      depreciationMethod: 'lump-sum',
      acquisitionCost: '150000',
      disposedDate: '2022-06-01',
    });
    expect(buildDisposalLines(a)).toEqual([]);
  });

  test('一括償却資産の売却は雑収入のみ（所令81条3号、譲渡所得にしない）', () => {
    const a = asset({
      depreciationMethod: 'lump-sum',
      acquisitionCost: '150000',
      disposedDate: '2022-06-01',
      disposalType: 'sale',
      salePrice: '30000',
    });
    expect(buildDisposalLines(a)).toEqual([
      { side: 'debit', accountCode: '1110', amount: '30000' },
      {
        side: 'credit',
        accountCode: '4910',
        amount: '30000',
        taxRate: 0.1,
        taxIncluded: true,
        taxableTransferConsideration: '30000',
      },
    ]);
    expect(
      buildDisposalLines(asset({ ...a, incomeType: 'realEstate' })).map((l) => l.accountCode),
    ).toEqual(['1110', '4920']);
  });

  test('転用資産は conversionBasis（開業仕訳で計上した額）で資産科目を落とす', () => {
    const a = asset({
      acquisitionDate: '2020-11-01',
      acquisitionCost: '300000',
      conversionBasis: '255180',
      serviceStartDate: '2022-01-01',
      disposedDate: '2023-06-30',
      disposalType: 'scrap',
    });
    const lines = buildDisposalLines(a);
    expect(lines).toContainEqual({ side: 'credit', accountCode: '1510', amount: '255180' });
    const debit = lines.filter((l) => l.side === 'debit').reduce((s, l) => s.plus(l.amount), D(0));
    expect(debit.toString()).toBe('255180');
  });
});

describe('buildDisposalLines（売却）', () => {
  test('売却価格が帳簿価額を上回る（益）→ 事業主借に差額', () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'sale' });
    const { bookValueEnd } = disposalBookValue(a);
    const salePrice = D(bookValueEnd).plus(100000).toString();
    const lines = buildDisposalLines(asset({ ...a, disposalType: 'sale', salePrice }));
    const debit = lines.filter((l) => l.side === 'debit').reduce((s, l) => s.plus(l.amount), D(0));
    const credit = lines
      .filter((l) => l.side === 'credit')
      .reduce((s, l) => s.plus(l.amount), D(0));
    expect(debit.toString()).toBe(credit.toString());
    expect(lines).toContainEqual({ side: 'credit', accountCode: '3120', amount: '100000' });
    expect(lines.some((l) => l.accountCode === '1610')).toBe(false);
  });

  test('売却価格が帳簿価額を下回る（損）→ 事業主貸に差額', () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'sale' });
    const { bookValueEnd } = disposalBookValue(a);
    const salePrice = D(bookValueEnd).minus(50000).toString();
    const lines = buildDisposalLines(asset({ ...a, disposalType: 'sale', salePrice }));
    const debit = lines.filter((l) => l.side === 'debit').reduce((s, l) => s.plus(l.amount), D(0));
    const credit = lines
      .filter((l) => l.side === 'credit')
      .reduce((s, l) => s.plus(l.amount), D(0));
    expect(debit.toString()).toBe(credit.toString());
    expect(lines).toContainEqual({ side: 'debit', accountCode: '1610', amount: '50000' });
    expect(lines.some((l) => l.accountCode === '3120')).toBe(false);
  });

  test('売却価格が帳簿価額と一致（損益なし）→ 事業主科目は使わない', () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'sale' });
    const { bookValueEnd } = disposalBookValue(a);
    const lines = buildDisposalLines(
      asset({ ...a, disposalType: 'sale', salePrice: bookValueEnd }),
    );
    expect(lines.some((l) => l.accountCode === '1610' || l.accountCode === '3120')).toBe(false);
    const debit = lines.filter((l) => l.side === 'debit').reduce((s, l) => s.plus(l.amount), D(0));
    const credit = lines
      .filter((l) => l.side === 'credit')
      .reduce((s, l) => s.plus(l.amount), D(0));
    expect(debit.toString()).toBe(credit.toString());
  });

  test('売却なのに salePrice 未設定なら例外', () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'sale' });
    expect(() => buildDisposalLines(a)).toThrow();
  });

  test('損益に関わらず損益計算書科目（収益・費用）は一切使わない', () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'sale', salePrice: '2000000' });
    const lines = buildDisposalLines(a);
    expect(
      lines.every((l) => !l.accountCode.startsWith('4') && !l.accountCode.startsWith('5')),
    ).toBe(true);
  });
});

describe('generateDisposalEntry', () => {
  test('当年分の償却仕訳が無ければ needs-year-end-depreciation', async () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'scrap' });
    await db.fixedAssets.add(a);
    const result = await generateDisposalEntry(a.id);
    expect(result).toEqual({ created: false, reason: 'needs-year-end-depreciation' });
    expect(await db.journalEntries.count()).toBe(0);
  });

  test('除却仕訳を作成し、貸借が一致する', async () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'scrap' });
    await db.fixedAssets.add(a);
    await generateYearEndDepreciation(2023);
    const result = await generateDisposalEntry(a.id);
    expect(result.created).toBe(true);
    const entries = await db.journalEntries
      .where({ year: 2023 })
      .filter((e) => e.description.includes('除却'))
      .toArray();
    expect(entries).toHaveLength(1);
    const lines = await db.journalLines.where('entryId').equals(entries[0]!.id).toArray();
    const debit = lines.filter((l) => l.side === 'debit').reduce((s, l) => s.plus(l.amount), D(0));
    const credit = lines
      .filter((l) => l.side === 'credit')
      .reduce((s, l) => s.plus(l.amount), D(0));
    expect(debit.toString()).toBe(credit.toString());
  });

  test('2回目は重複としてスキップする', async () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'scrap' });
    await db.fixedAssets.add(a);
    await generateYearEndDepreciation(2023);
    await generateDisposalEntry(a.id);
    const second = await generateDisposalEntry(a.id);
    expect(second).toEqual({ created: false, reason: 'already-exists' });
    const disposals = await db.journalEntries
      .where({ year: 2023 })
      .filter((e) => e.description.includes('除却'))
      .toArray();
    expect(disposals).toHaveLength(1);
  });

  test('償却額ゼロの年（既に償却済み）は年末仕訳が無くても作れる', async () => {
    // 少額特例は取得年に全額償却済み。翌年以降は当年分の償却額がゼロ。
    const a = asset({
      depreciationMethod: 'small-asset-special',
      acquisitionCost: '200000',
      acquisitionDate: '2022-04-01',
      disposedDate: '2023-06-30',
      disposalType: 'scrap',
    });
    await db.fixedAssets.add(a);
    const result = await generateDisposalEntry(a.id);
    expect(result.created).toBe(true);
  });

  test('disposedDate 未設定なら no-disposal', async () => {
    const a = asset();
    await db.fixedAssets.add(a);
    const result = await generateDisposalEntry(a.id);
    expect(result).toEqual({ created: false, reason: 'no-disposal' });
  });

  test('売却で salePrice 未設定なら missing-sale-price', async () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'sale' });
    await db.fixedAssets.add(a);
    const result = await generateDisposalEntry(a.id);
    expect(result).toEqual({ created: false, reason: 'missing-sale-price' });
  });

  test('一括償却資産の除却は仕訳を作らない', async () => {
    const a = asset({
      depreciationMethod: 'lump-sum',
      acquisitionCost: '150000',
      disposedDate: '2022-06-01',
    });
    await db.fixedAssets.add(a);
    const result = await generateDisposalEntry(a.id);
    expect(result).toEqual({ created: false, reason: 'lump-sum-scrap-no-entry' });
    expect(await db.journalEntries.count()).toBe(0);
  });

  test('一括償却資産の売却は年末償却仕訳を待たずに雑収入の仕訳を作る', async () => {
    const a = asset({
      depreciationMethod: 'lump-sum',
      acquisitionCost: '150000',
      disposedDate: '2022-06-01',
      disposalType: 'sale',
      salePrice: '30000',
    });
    await db.fixedAssets.add(a);
    const result = await generateDisposalEntry(a.id);
    expect(result).toEqual({ created: true });
    const lines = await db.journalLines.toArray();
    expect(lines.map((l) => `${l.side}:${l.accountCode}:${l.amount}`).sort()).toEqual([
      'credit:4910:30000',
      'debit:1110:30000',
    ]);
  });
});

describe('estimateTransferIncome', () => {
  test('売却時のみ試算を返す（益のケース）', () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'sale' });
    const { bookValueEnd } = disposalBookValue(a);
    const salePrice = D(bookValueEnd).plus(200000).toString();
    const est = estimateTransferIncome(asset({ ...a, disposalType: 'sale', salePrice }));
    expect(est).not.toBeNull();
    expect(est!.estimate).toBe('200000');
    expect(est!.holdingYears).toBe(1);
  });

  test('譲渡費用を控除する', () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'sale' });
    const { bookValueEnd } = disposalBookValue(a);
    const salePrice = D(bookValueEnd).plus(200000).toString();
    const est = estimateTransferIncome(
      asset({ ...a, disposalType: 'sale', salePrice, saleExpenses: '30000' }),
    );
    expect(est!.estimate).toBe('170000');
  });

  test('除却（scrap）なら null', () => {
    const a = asset({ disposedDate: '2023-06-30', disposalType: 'scrap' });
    expect(estimateTransferIncome(a)).toBeNull();
  });

  test('未売却（disposedDate 無し）なら null', () => {
    expect(estimateTransferIncome(asset())).toBeNull();
  });

  function holdingYears(acquisitionDate: string, disposedDate: string): number {
    const a = asset({
      acquisitionDate,
      disposedDate,
      disposalType: 'sale',
      salePrice: '1',
    });
    return estimateTransferIncome(a)!.holdingYears;
  }
  // 応当日基準の暦計算：5 年境界の前後・うるう年またぎ・同日を検証する。
  test('応当日の前日は満年数が 1 少ない（4 年）', () => {
    expect(holdingYears('2020-06-15', '2025-06-14')).toBe(4);
  });

  test('応当日当日は満年数に達する（5 年）', () => {
    expect(holdingYears('2020-06-15', '2025-06-15')).toBe(5);
  });

  test('2/29 取得を平年 2/28 に処分すると未満（4 年）', () => {
    expect(holdingYears('2020-02-29', '2025-02-28')).toBe(4);
  });

  test('2/29 取得を平年 3/1 に処分すると満了（5 年）', () => {
    expect(holdingYears('2020-02-29', '2025-03-01')).toBe(5);
  });

  test('同日取得・処分は 0 年', () => {
    expect(holdingYears('2023-06-30', '2023-06-30')).toBe(0);
  });
});

describe('一括償却資産の除却・売却（所令139条・81条3号）', () => {
  test('F13：除却年も翌年以後も 3 年均等の償却額を計上し、譲渡所得は生じない', () => {
    const a = asset({
      depreciationMethod: 'lump-sum',
      acquisitionDate: '2026-01-01',
      acquisitionCost: '180000',
      disposedDate: '2027-06-30',
      disposalType: 'sale',
      salePrice: '100000',
    });
    expect(computeDepreciation(a, 2027).amount).toBe('60000');
    expect(computeDepreciation(a, 2028).amount).toBe('60000');
    expect(estimateTransferIncome(a)).toBeNull();
    expect(transferIncomeByTerm([a], 2027)).toEqual({ shortTerm: '0', longTerm: '0', count: 0 });
  });

  test('所令138条の一次費用化資産の売却も譲渡所得にしない（所令81条2号）', () => {
    const a = asset({
      depreciationMethod: 'small-asset-special',
      acquisitionCost: '50000',
      acquisitionDate: '2026-01-01',
      disposedDate: '2026-06-30',
      disposalType: 'sale',
      salePrice: '20000',
    });
    expect(estimateTransferIncome(a)).toBeNull();
  });
});

describe('aggregateTransferIncome（所法33条3項〜5項・22条2項2号）', () => {
  test('F11：特別控除は短期から先に 300,000、残り 200,000 を長期から。長期 200,000 の 1/2', () => {
    const r = aggregateTransferIncome({
      shortTerm: '300000',
      longTerm: '400000',
      occasionalIncome: '0',
    });
    expect(r.gain).toBe('700000');
    expect(r.specialDeduction).toBe('500000');
    expect(r.shortTermIncome).toBe('0');
    expect(r.longTermIncome).toBe('200000');
    expect(r.halfOfLongTermAndOccasional).toBe('100000');
  });

  test('F12：短期 −100,000・長期 400,000 は通算後の譲渡益 300,000、特別控除 300,000', () => {
    const r = aggregateTransferIncome({ shortTerm: '-100000', longTerm: '400000' });
    expect(r.gain).toBe('300000');
    expect(r.specialDeduction).toBe('300000');
    expect(r.shortTermIncome).toBe('0');
    expect(r.longTermIncome).toBe('0');
    expect(r.halfOfLongTermAndOccasional).toBe('0');
  });

  test('長期の譲渡所得と一時所得の合計額の 1/2', () => {
    const r = aggregateTransferIncome({
      shortTerm: '0',
      longTerm: '800000',
      occasionalIncome: '100000',
    });
    expect(r.longTermIncome).toBe('300000');
    expect(r.halfOfLongTermAndOccasional).toBe('200000');
  });

  test('通算しても損失が残れば譲渡益 0・特別控除 0、損失は元の側に残す', () => {
    const r = aggregateTransferIncome({ shortTerm: '100000', longTerm: '-300000' });
    expect(r.gain).toBe('0');
    expect(r.specialDeduction).toBe('0');
    expect(r.shortTermIncome).toBe('0');
    expect(r.longTermIncome).toBe('-200000');
  });
});

describe('transferIncomeByTerm', () => {
  test('取得から 5 年以内の譲渡は短期、応当日以後は長期', () => {
    const short = asset({
      id: 'short',
      acquisitionDate: '2021-06-15',
      disposedDate: '2026-06-14',
      disposalType: 'sale',
      salePrice: '1',
    });
    const long = asset({
      id: 'long',
      acquisitionDate: '2021-06-15',
      disposedDate: '2026-06-15',
      disposalType: 'sale',
      salePrice: '1',
    });
    const shortEstimate = estimateTransferIncome(short)!.estimate;
    const longEstimate = estimateTransferIncome(long)!.estimate;
    const r = transferIncomeByTerm([short, long, asset({ id: 'kept' })], 2026);
    expect(r).toEqual({ shortTerm: shortEstimate, longTerm: longEstimate, count: 2 });
  });
});

describe('F17：総合課税への書き換え', () => {
  test('types.ts と asset-disposal.ts に「分離課税」「第三表」が残っていない', () => {
    for (const file of ['src/db/types.ts', 'src/domain/asset-disposal.ts']) {
      const text = readFileSync(file, 'utf8');
      for (const term of ['分離課税', 'separate taxation', '分離課稅', '第三表']) {
        expect(text.includes(term), `${file}: ${term}`).toBe(false);
      }
    }
  });
});
describe('D2-4：所令81条2号・3号の例外（essentialToBusiness）', () => {
  test('D2-F6(a)：138条資産・10万円未満・使用可能期間1年未満でなく・業務上基本重要 → 譲渡所得に計入', () => {
    const a = asset({
      depreciationMethod: 'small-asset-special',
      acquisitionCost: '80000',
      essentialToBusiness: true,
      disposalType: 'sale',
      disposedDate: '2026-06-01',
      salePrice: '50000',
    });
    expect(estimateTransferIncome(a)).not.toBeNull();
    expect(transferIncomeByTerm([a], 2026).count).toBe(1);
  });

  test('D2-F6(a2)：使用可能期間1年未満は業務上基本重要でも譲渡所得にならない', () => {
    const a = asset({
      depreciationMethod: 'small-asset-special',
      acquisitionCost: '80000',
      usableLifeUnderOneYear: true,
      essentialToBusiness: true,
      disposalType: 'sale',
      disposedDate: '2026-06-01',
      salePrice: '50000',
    });
    expect(estimateTransferIncome(a)).toBeNull();
  });

  test('D2-F6(b)：原始取得価額10万円以上の138条資産は業務上基本重要でも譲渡所得にならない', () => {
    const a = asset({
      depreciationMethod: 'small-asset-special',
      acquisitionCost: '150000',
      usableLifeUnderOneYear: true,
      essentialToBusiness: true,
      disposalType: 'sale',
      disposedDate: '2026-06-01',
      salePrice: '50000',
    });
    expect(estimateTransferIncome(a)).toBeNull();
  });

  test('D2-F6(c)：essentialToBusiness な一括償却資産の売却は現金／事業主借のみ、4910/4920 なし、取得費0で譲渡所得に計入', () => {
    const a = asset({
      depreciationMethod: 'lump-sum',
      acquisitionCost: '150000',
      essentialToBusiness: true,
      acquisitionDate: '2026-01-01',
      disposalType: 'sale',
      disposedDate: '2027-06-01',
      salePrice: '60000',
    });
    const lines = buildDisposalLines(a);
    expect(lines.some((l) => l.accountCode === '4910' || l.accountCode === '4920')).toBe(false);
    const cash = lines.find((l) => l.accountCode === '1110');
    const draw = lines.find((l) => l.accountCode === '3120');
    expect(cash?.side).toBe('debit');
    expect(cash?.amount).toBe('60000');
    expect(draw?.side).toBe('credit');
    expect(draw?.amount).toBe('60000');
    const estimate = estimateTransferIncome(a);
    expect(estimate).not.toBeNull();
    expect(estimate?.acquisitionExpense).toBe('0');
    expect(estimate?.estimate).toBe('60000');
    // 3 年均等償却は継続する（第2・3年に各50,000）
    expect(computeDepreciation(a, 2027).amount).toBe('50000');
    expect(computeDepreciation(a, 2028).amount).toBe('50000');
  });
});

describe('D2-6：出售資産の消費税（消令2条3項・消法28条1項）', () => {
  test('D2-F8：一般資産の売却は貸方の資産行に課税対価が付く', () => {
    const a = asset({ disposalType: 'sale', disposedDate: '2026-06-01', salePrice: '110000' });
    const lines = buildDisposalLines(a);
    const assetLine = lines.find((l) => l.accountCode === '1510');
    expect(assetLine?.taxableTransferConsideration).toBe('110000');
    expect(assetLine?.taxRate).toBe(0.1);
    expect(assetLine?.taxIncluded).toBe(true);
  });

  test('D2-F8：除却（無対価）は課税対価を設定しない', () => {
    const a = asset({ disposalType: 'scrap', disposedDate: '2026-06-01' });
    const lines = buildDisposalLines(a);
    expect(lines.every((l) => l.taxableTransferConsideration === undefined)).toBe(true);
  });

  test('D2-F8b：非essentialな一括償却資産の売却は雑収入行に課税対価（簡易課税で第四種）が付く', async () => {
    const { ACCOUNTS_2026 } = await import('../tax-schema/2026');
    const { buildYayoiCsvRows } = await import('./accountant-export');
    const { processYear } = await import('./consumption-tax');
    await db.accounts.bulkPut(ACCOUNTS_2026.map((acc) => ({ ...acc, year: 2026 })));
    const a = asset({
      id: 'lump',
      depreciationMethod: 'lump-sum',
      acquisitionCost: '150000',
      acquisitionDate: '2026-01-01',
      disposalType: 'sale',
      disposedDate: '2026-06-01',
      salePrice: '110000',
    });
    await db.fixedAssets.add(a);
    const r = await generateDisposalEntry(a.id);
    expect(r.created).toBe(true);
    const entries = await db.journalEntries.toArray();
    const lines = await db.journalLines.toArray();
    const processed = await processYear(2026);
    expect(processed.taxableBase10.toString()).toBe('100000');
    const rows = buildYayoiCsvRows(entries, lines, await db.accounts.toArray(), [], {
      taxFilingMethod: 'simplified',
      simplifiedTaxCategory: 5,
    });
    const marked = rows.filter((row) => row.some((cell) => cell.includes('課税売上込四10%')));
    expect(marked).toHaveLength(1);
    expect(marked[0]?.includes('110000')).toBe(true);
  });
});

describe('D2-3／D2-6：落選資産（D2-F5の8番目）を2027年に売却する（domain レベル）', () => {
  test('D2-F12：1520 debit は定額法の2026＋2027累計、estimateTransferIncome().acquisitionExpense も同じ帳簿価額', async () => {
    const { generateYearEndDepreciation, smallAssetSpecialStatuses } =
      await import('./depreciation');
    const dates = ['04-01', '05-01', '06-01', '07-01', '08-01', '09-01', '10-01', '11-01'];
    await db.fixedAssets.bulkAdd(
      dates.map((d, i) => ({
        id: `f12-${i}`,
        name: `資産${i}`,
        acquisitionDate: `2026-${d}`,
        acquisitionCost: '390000',
        usefulLifeYears: 4,
        depreciationMethod: 'small-asset-special' as const,
        accountCode: '1510',
      })),
    );
    const r2026 = await generateYearEndDepreciation(2026);
    expect(r2026.smallAssetCapExceeded).toBe(1);
    const eighth = (await db.fixedAssets.get('f12-7'))!;
    // 2026 の年末償却時点（月按分2か月）：390,000×0.250×2/12=16,250
    const entries2026 = await db.journalEntries.where('year').equals(2026).toArray();
    const tag = `#${eighth.id.slice(0, 8)}`;
    const entry2026 = entries2026.find((e) => e.description.includes(tag));
    const lines2026 = await db.journalLines.where('entryId').equals(entry2026!.id).toArray();
    expect(lines2026.find((l) => l.accountCode === '5210')?.amount).toBe('16250');

    // 2027-08-01 に売却。先に disposedDate を立ててから当年分の年末償却を月按分で作る
    // （generateDisposalEntry が要求する「当年分の年末償却が先に存在すること」を満たす）。
    await db.fixedAssets.put({
      ...eighth,
      disposedDate: '2027-08-01',
      disposalType: 'sale',
      salePrice: '400000',
    });
    const r2027 = await generateYearEndDepreciation(2027);
    expect(r2027.created).toBe(1);
    const entries2027 = await db.journalEntries.where('year').equals(2027).toArray();
    const entry2027 = entries2027.find((e) => e.description.includes(tag));
    const lines2027 = await db.journalLines.where('entryId').equals(entry2027!.id).toArray();
    // 2027（disposedMonth=8）：390,000×0.250×8/12=65,000
    expect(lines2027.find((l) => l.accountCode === '5210')?.amount).toBe('65000');

    const asset = (await db.fixedAssets.get('f12-7'))!;
    const statuses = smallAssetSpecialStatuses(await db.fixedAssets.toArray());
    const disposalLines = buildDisposalLines(asset, '1110', statuses);
    // 累計 16,250 + 65,000 = 81,250
    const accDep = disposalLines.find((l) => l.accountCode === '1520');
    expect(accDep?.side).toBe('debit');
    expect(accDep?.amount).toBe('81250');

    const result = await generateDisposalEntry(asset.id, '1110', { allowFiledYear: true });
    expect(result.created).toBe(true);
    const disposalEntries = await db.journalEntries.where('year').equals(2027).toArray();
    const disposalEntry = disposalEntries.find((e) => e.description.includes('固定資産売却'));
    const disposalJournalLines = await db.journalLines
      .where('entryId')
      .equals(disposalEntry!.id)
      .toArray();
    expect(disposalJournalLines.find((l) => l.accountCode === '1520')?.amount).toBe('81250');

    const estimate = estimateTransferIncome(asset, statuses);
    // 定額法帳簿価額：390,000 − 81,250 = 308,750
    expect(estimate?.acquisitionExpense).toBe('308750');
  });
});
