import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { db } from '../db/db';
import {
  computeConvertedAssetBasis,
  generateOpeningEntries,
  oldStraightLineRate,
  removeOpeningEntries,
} from './business-opening';
import type { OpeningSetupInput, OpeningSetupResult } from './business-opening';

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

  it('長期保有でも減価の額は取得価額の95%が上限（未償却残高は負にならない）', () => {
    // 耐用5年→1.5倍で7年→0.142。1年あたり 300000×0.9×0.142＝38340。
    // 2016-06 取得・2026-01 供用は9年（6ヶ月以上で切上げ）→ 上限が無ければ 345,060 で
    // 未償却残高が −45,060 になる。上限 300000×0.95＝285,000 で頭打ちにする。
    const result = computeConvertedAssetBasis('2016-06-01', '2026-01-01', '300000', 5);
    expect(result.nonBusinessDepreciation.toString()).toBe('285000');
    expect(result.businessStartBasis.toString()).toBe('15000');
  });

  it('自宅兼事務所（木造22年・鉄筋47年）でも算定できる', () => {
    // 木造22年→1.5倍で33年→0.031。1年あたり 20,000,000×0.9×0.031＝558,000。
    const wooden = computeConvertedAssetBasis('2021-01-01', '2026-01-01', '20000000', 22);
    expect(wooden.nonBusinessDepreciation.toString()).toBe('2790000');
    expect(wooden.businessStartBasis.toString()).toBe('17210000');
    // 鉄筋47年→1.5倍で70年→0.015。1年あたり 30,000,000×0.9×0.015＝405,000。
    const rc = computeConvertedAssetBasis('2021-01-01', '2026-01-01', '30000000', 47);
    expect(rc.nonBusinessDepreciation.toString()).toBe('2025000');
    expect(rc.businessStartBasis.toString()).toBe('27975000');
  });
});

describe('非業務期間の月数計算（応当日ベース）', () => {
  // 耐用年数4年→1.5倍で6年→旧定額法償却率0.166。1年あたりの非業務減価＝300000×0.9×0.166＝44820。
  const cost = '300000';
  const life = 4;

  it('応当日の前日は満了とみなさず切り捨て：2025-06-30取得→2025-12-01供用は5か月1日で0年', () => {
    const result = computeConvertedAssetBasis('2025-06-30', '2025-12-01', cost, life);
    expect(result.nonBusinessDepreciation.toString()).toBe('0');
    expect(result.businessStartBasis.toString()).toBe('300000');
  });

  it('応当日ちょうどで6か月に達し1年に切り上げ：2025-06-30→2025-12-30', () => {
    const result = computeConvertedAssetBasis('2025-06-30', '2025-12-30', cost, life);
    expect(result.nonBusinessDepreciation.toString()).toBe('44820');
  });

  it('応当日の翌日も6か月のまま1年：2025-06-30→2025-12-31', () => {
    const result = computeConvertedAssetBasis('2025-06-30', '2025-12-31', cost, life);
    expect(result.nonBusinessDepreciation.toString()).toBe('44820');
  });

  it('月末取得は応当日不在月をその月の末日で満了：2024-08-31→2025-02-28は6か月で1年', () => {
    const result = computeConvertedAssetBasis('2024-08-31', '2025-02-28', cost, life);
    expect(result.nonBusinessDepreciation.toString()).toBe('44820');
  });

  it('月末取得で満期日（末日）の前日はまだ満了しない：2024-08-31→2025-02-27は5か月で0年', () => {
    const result = computeConvertedAssetBasis('2024-08-31', '2025-02-27', cost, life);
    expect(result.nonBusinessDepreciation.toString()).toBe('0');
  });

  it('うるう年2/29取得は翌年2/28を満期日とみなし12か月ちょうどで1年：2024-02-29→2025-02-28', () => {
    const result = computeConvertedAssetBasis('2024-02-29', '2025-02-28', cost, life);
    expect(result.nonBusinessDepreciation.toString()).toBe('44820');
  });

  it('うるう年2/29取得の応当日は各月29日：2024-08-29で6か月（1年）', () => {
    const result = computeConvertedAssetBasis('2024-02-29', '2024-08-29', cost, life);
    expect(result.nonBusinessDepreciation.toString()).toBe('44820');
  });

  it('うるう年2/29取得の応当日前日は満了しない：2024-08-28で5か月（0年）', () => {
    const result = computeConvertedAssetBasis('2024-02-29', '2024-08-28', cost, life);
    expect(result.nonBusinessDepreciation.toString()).toBe('0');
  });

  it('跨年の6か月境界の手前は0年：2025-10-15→2026-04-14は5か月', () => {
    const result = computeConvertedAssetBasis('2025-10-15', '2026-04-14', cost, life);
    expect(result.nonBusinessDepreciation.toString()).toBe('0');
  });

  it('跨年の6か月境界ちょうどは1年：2025-10-15→2026-04-15', () => {
    const result = computeConvertedAssetBasis('2025-10-15', '2026-04-15', cost, life);
    expect(result.nonBusinessDepreciation.toString()).toBe('44820');
  });
});

describe('generateOpeningEntries', () => {
  // 二重実行の判定は専用のテストで確認する。他のテストは生成が通る前提なので、
  // ここで絞り込んでおき、各テストが result.entryIds を素直に読めるようにする。
  async function generateOk(input: OpeningSetupInput): Promise<OpeningSetupResult> {
    const result = await generateOpeningEntries(input);
    if ('reason' in result) {
      throw new Error(`生成されませんでした：${result.reason}`);
    }
    return result;
  }

  it('開業費のみ：全額費用化で計上仕訳と償却仕訳の2本を生成', async () => {
    const result = await generateOk({
      businessStartDate: '2026-07-01',
      expenses: [
        { name: '名刺', amount: '1000' },
        { name: '広告費', amount: '9000' },
      ],
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
    const result = await generateOk({
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
    const result = await generateOk({
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
    const result = await generateOk({
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
    const result = await generateOk({
      businessStartDate: '2026-07-01',
      expenses: [],
      expenseAmortization: 'immediate',
      convertedAssets: [],
      customItems: [],
    });
    expect(result.entryIds).toHaveLength(0);
    expect(result.assetIds).toHaveLength(0);
  });

  it('2回目は already-exists を返し、仕訳も固定資産も増やさない', async () => {
    const input: OpeningSetupInput = {
      businessStartDate: '2026-07-01',
      expenses: [{ name: '名刺', amount: '10000' }],
      expenseAmortization: 'immediate',
      convertedAssets: [
        {
          name: 'ノートPC',
          acquisitionDate: '2024-01-10',
          acquisitionCost: '300000',
          usefulLifeYears: 4,
          accountCode: '1410',
          depreciationMethod: 'straight-line',
        },
      ],
      customItems: [],
    };
    await generateOk(input);
    const entriesAfterFirst = await db.journalEntries.count();
    const assetsAfterFirst = await db.fixedAssets.count();

    const second = await generateOpeningEntries(input);
    expect(second).toEqual({ reason: 'already-exists' });
    expect(await db.journalEntries.count()).toBe(entriesAfterFirst);
    expect(await db.fixedAssets.count()).toBe(assetsAfterFirst);
  });

  it('開業年度が違えば作成できる（判定は年度スコープ）', async () => {
    await generateOk({
      businessStartDate: '2026-07-01',
      expenses: [{ name: '名刺', amount: '10000' }],
      expenseAmortization: 'immediate',
      convertedAssets: [],
      customItems: [],
    });
    const other = await generateOpeningEntries({
      businessStartDate: '2027-01-05',
      expenses: [{ name: '名刺', amount: '10000' }],
      expenseAmortization: 'immediate',
      convertedAssets: [],
      customItems: [],
    });
    expect('entryIds' in other).toBe(true);
  });
});

describe('removeOpeningEntries', () => {
  const input: OpeningSetupInput = {
    businessStartDate: '2026-07-01',
    expenses: [{ name: '名刺', amount: '10000' }],
    expenseAmortization: 'immediate',
    convertedAssets: [
      {
        name: 'ノートPC',
        acquisitionDate: '2024-01-10',
        acquisitionCost: '300000',
        usefulLifeYears: 4,
        accountCode: '1410',
        depreciationMethod: 'straight-line',
      },
    ],
    customItems: [],
  };

  it('対象が無ければ removed: false', async () => {
    expect(await removeOpeningEntries(2026)).toEqual({ removed: false });
  });

  it('開業仕訳を打ち消し、精霊が登録した資産を消す', async () => {
    await generateOpeningEntries(input);
    const created = await db.journalEntries.where('year').equals(2026).toArray();

    expect(await removeOpeningEntries(2026)).toEqual({ removed: true });

    for (const orig of created) {
      const after = await db.journalEntries.get(orig.id);
      expect(after?.status).toBe('reversed');
      expect(after?.reversedByEntryId).toBeDefined();
      const reversal = await db.journalEntries.get(after!.reversedByEntryId!);
      // 年をまたぐと開業年度が変わってしまうので、打消しは原仕訳と同じ日付
      expect(reversal?.date).toBe(orig.date);
      expect(reversal?.originalEntryId).toBe(orig.id);
      const origLines = await db.journalLines
        .where('entryId')
        .equals(orig.id)
        .sortBy('accountCode');
      const revLines = await db.journalLines
        .where('entryId')
        .equals(reversal!.id)
        .sortBy('accountCode');
      expect(revLines.map((l) => l.side)).toEqual(
        origLines.map((l) => (l.side === 'debit' ? 'credit' : 'debit')),
      );
      expect(revLines.map((l) => l.amount)).toEqual(origLines.map((l) => l.amount));
    }
    expect(await db.fixedAssets.count()).toBe(0);
  });

  it('打ち消したあとは同じ年度で作り直せる', async () => {
    await generateOpeningEntries(input);
    await removeOpeningEntries(2026);
    const again = await generateOpeningEntries(input);
    expect('entryIds' in again).toBe(true);
    expect(await db.fixedAssets.count()).toBe(1);
  });

  it('資産を参照する減価償却仕訳があれば中止し、仕訳も資産も触らない', async () => {
    await generateOpeningEntries(input);
    const asset = (await db.fixedAssets.toArray())[0]!;
    await db.journalEntries.add({
      id: 'dep-1',
      date: '2026-12-31',
      year: 2026,
      description: `減価償却 ${asset.name} #${asset.id.slice(0, 8)}`,
      status: 'confirmed',
      source: 'manual',
      createdAt: Date.now(),
      confirmedAt: Date.now(),
    });
    const entriesBefore = await db.journalEntries.count();

    expect(await removeOpeningEntries(2026)).toEqual({
      reason: 'has-depreciation',
      assetNames: ['ノートPC'],
    });
    expect(await db.journalEntries.count()).toBe(entriesBefore);
    expect(await db.fixedAssets.count()).toBe(1);
    const opening = await db.journalEntries.where('year').equals(2026).toArray();
    expect(opening.every((e) => e.status !== 'reversed')).toBe(true);
  });

  it('印の無い固定資産は消さない（この仕組みより前に作られた資産）', async () => {
    await generateOpeningEntries(input);
    const asset = (await db.fixedAssets.toArray())[0]!;
    const { source: _source, ...withoutMarker } = asset;
    await db.fixedAssets.put(withoutMarker);

    expect(await removeOpeningEntries(2026)).toEqual({ removed: true });
    expect(await db.fixedAssets.count()).toBe(1);
  });
});
