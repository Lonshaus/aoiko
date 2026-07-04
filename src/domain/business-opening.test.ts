import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { db } from '../db/db';
import { computeConvertedAssetBasis, generateOpeningEntries, oldStraightLineRate } from './business-opening';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('oldStraightLineRate', () => {
  it('6年の旧定額法償却率は0.166', () => {
    expect(oldStraightLineRate(6).toString()).toBe('0.166');
  });

  it('未定義の耐用年数はエラー', () => {
    expect(() => oldStraightLineRate(999)).toThrow();
  });
});

describe('computeConvertedAssetBasis', () => {
  it('国税庁の計算例（30万円・耐用年数4年・2020-11-01取得→2022-01-01供用）', () => {
    const result = computeConvertedAssetBasis('2020-11-01', '2022-01-01', '300000', 4);
    expect(result.nonBusinessDepreciation.toString()).toBe('44820');
    expect(result.businessStartBasis.toString()).toBe('255180');
  });

  it('非業務期間が6ヶ月ちょうどは1年に切り上げる', () => {
    const result = computeConvertedAssetBasis('2026-01-01', '2026-07-01', '300000', 4);
    expect(result.nonBusinessDepreciation.toString()).toBe('44820');
  });

  it('非業務期間が6ヶ月未満は切り捨てる（0年扱い）', () => {
    const result = computeConvertedAssetBasis('2025-08-01', '2026-01-01', '300000', 4);
    expect(result.nonBusinessDepreciation.toString()).toBe('0');
    expect(result.businessStartBasis.toString()).toBe('300000');
  });

  it('取得日と供用日が同月なら未償却残高は取得価額と同じ', () => {
    const result = computeConvertedAssetBasis('2026-07-01', '2026-07-15', '100000', 5);
    expect(result.businessStartBasis.toString()).toBe('100000');
  });
});

describe('generateOpeningEntries', () => {
  it('開業費のみ：全額費用化で計上仕訳と償却仕訳の2本を生成', async () => {
    const result = await generateOpeningEntries({
      businessStartDate: '2026-07-01',
      expenses: [{ name: '名刺', amount: '1000' }, { name: '広告費', amount: '9000' }],
      expenseAmortization: 'immediate',
      convertedAssets: [],
      customItems: [],
    });
    expect(result.entryIds).toHaveLength(2);
    expect(result.assetIds).toHaveLength(0);

    const lines = await db.journalLines.where('entryId').anyOf(result.entryIds).toArray();
    const kaigyohiDebit = lines.find((l) => l.accountCode === '1530' && l.side === 'debit');
    const kaigyohiCredit = lines.find((l) => l.accountCode === '1530' && l.side === 'credit');
    expect(kaigyohiDebit?.amount).toBe('10000');
    expect(kaigyohiCredit?.amount).toBe('10000');
    const amortDebit = lines.find((l) => l.accountCode === '5210');
    expect(amortDebit?.amount).toBe('10000');
  });

  it('開業費：5年均等償却は初年度分（1/5）のみ費用化', async () => {
    const result = await generateOpeningEntries({
      businessStartDate: '2026-07-01',
      expenses: [{ name: 'サイト制作', amount: '500000' }],
      expenseAmortization: 'five-year',
      convertedAssets: [],
      customItems: [],
    });
    const lines = await db.journalLines.where('entryId').anyOf(result.entryIds).toArray();
    const amortDebit = lines.find((l) => l.accountCode === '5210');
    expect(amortDebit?.amount).toBe('100000');
    const kaigyohiCredit = lines.find((l) => l.accountCode === '1530' && l.side === 'credit');
    expect(kaigyohiCredit?.amount).toBe('100000');
  });

  it('転用資産：固定資産登録＋開業時未償却残高で元入金と貸借が合う', async () => {
    const result = await generateOpeningEntries({
      businessStartDate: '2022-01-01',
      expenses: [],
      expenseAmortization: 'immediate',
      convertedAssets: [
        {
          name: 'パソコン',
          acquisitionDate: '2020-11-01',
          acquisitionCost: '300000',
          usefulLifeYears: 4,
          accountCode: '1510',
          depreciationMethod: 'straight-line',
        },
      ],
      customItems: [],
    });
    expect(result.assetIds).toHaveLength(1);
    const asset = await db.fixedAssets.get(result.assetIds[0]!);
    expect(asset?.acquisitionCost).toBe('255180');
    expect(asset?.acquisitionDate).toBe('2022-01-01');

    const lines = await db.journalLines.where('entryId').anyOf(result.entryIds).toArray();
    const assetLine = lines.find((l) => l.accountCode === '1510');
    const capitalLine = lines.find((l) => l.accountCode === '3110');
    expect(assetLine?.side).toBe('debit');
    expect(assetLine?.amount).toBe('255180');
    expect(capitalLine?.side).toBe('credit');
    expect(capitalLine?.amount).toBe('255180');
  });

  it('自由項目：貸方指定なら元入金は借方で相殺', async () => {
    const result = await generateOpeningEntries({
      businessStartDate: '2026-07-01',
      expenses: [],
      expenseAmortization: 'immediate',
      convertedAssets: [],
      customItems: [{ name: '未払金', amount: '5000', accountCode: '2120', side: 'credit' }],
    });
    const lines = await db.journalLines.where('entryId').anyOf(result.entryIds).toArray();
    const customLine = lines.find((l) => l.accountCode === '2120');
    const capitalLine = lines.find((l) => l.accountCode === '3110');
    expect(customLine?.side).toBe('credit');
    expect(capitalLine?.side).toBe('debit');
    expect(capitalLine?.amount).toBe('5000');
  });

  it('全項目が空なら仕訳は生成しない', async () => {
    const result = await generateOpeningEntries({
      businessStartDate: '2026-07-01',
      expenses: [],
      expenseAmortization: 'immediate',
      convertedAssets: [],
      customItems: [],
    });
    expect(result.entryIds).toHaveLength(0);
    expect(result.assetIds).toHaveLength(0);
  });
});