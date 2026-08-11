// 申告済み年度へ書き込む入口が、画面の確認を経ずに呼ばれても止まることを確かめる。
//
// 画面側には filedYearGuard の確認ダイアログがあるが、それは案内であって防壁ではない。
// 画面を経ない経路（復元後の再実行、将来増える入口）から申告済み年度が書き換わると、
// 電子帳簿保存法上まずいうえに気付く手段が無い。ここで守るのは domain 側の門。
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { generateDisposalEntry } from './asset-disposal';
import { applyBadDebtReversal } from './bad-debt-reversal';
import { generateOpeningEntries, removeOpeningEntries } from './business-opening';
import { applyCarryover, removeCarryover } from './carryover';
import { generateYearEndDepreciation } from './depreciation';
import { commitImport, type ImportRow } from './import';
import { markYearFiled } from './snapshots';
import { FiledYearError } from './year-lock';
import type { ReportSnapshotData } from '../db/types';

const LOCKED = 2026;
const monthlySales: ReportSnapshotData & { type: 'monthly-sales' } = {
  type: 'monthly-sales',
  data: { months: [] },
};
const pl: ReportSnapshotData & { type: 'pl' } = {
  type: 'pl',
  data: { rows: [], totalRevenue: '0', totalExpense: '0', netIncome: '0' },
};

beforeEach(async () => {
  await db.delete();
  await db.open();
  await markYearFiled(LOCKED, { monthlySales, pl }, `${LOCKED}-12-31`);
});

afterEach(async () => {
  await db.delete();
});

function importInfo(date: string) {
  return {
    parserName: 'test',
    fileName: 'test.csv',
    fileHash: `hash-${date}`,
    knownAccountCode: '1110',
  };
}

function importRow(date: string): ImportRow {
  return {
    transaction: { date, description: 'テスト', amount: '1000', side: 'debit', rawRow: {} },
    counterpartAccountCode: '5110',
  };
}

async function seedDisposedAsset(disposedDate: string): Promise<string> {
  const id = `asset-${disposedDate}`;
  await db.fixedAssets.add({
    id,
    name: 'テスト資産',
    acquisitionDate: '2020-01-01',
    acquisitionCost: '300000',
    usefulLifeYears: 5,
    depreciationMethod: 'straight-line',
    accountCode: '1510',
    disposedDate,
    disposalType: 'scrap',
  });
  return id;
}

describe('申告済み年度への書き込みは domain 側で止まる', () => {
  test('commitImport', async () => {
    const date = `${LOCKED}-05-01`;
    await expect(commitImport(importInfo(date), [importRow(date)])).rejects.toThrow(FiledYearError);
    // 止まったなら取込バッチも仕訳も残っていない。
    expect(await db.importBatches.count()).toBe(0);
    expect(await db.journalEntries.count()).toBe(0);
  });

  test('commitImport は 1 行でも申告済み年度なら全体を止める', async () => {
    const rows = [importRow(`${LOCKED - 1}-05-01`), importRow(`${LOCKED}-05-01`)];
    await expect(commitImport(importInfo('mixed'), rows)).rejects.toThrow(FiledYearError);
    expect(await db.journalEntries.count()).toBe(0);
  });

  test('applyCarryover', async () => {
    await expect(applyCarryover(LOCKED)).rejects.toThrow(FiledYearError);
  });

  test('removeCarryover', async () => {
    await expect(removeCarryover(LOCKED)).rejects.toThrow(FiledYearError);
  });

  test('applyBadDebtReversal', async () => {
    await expect(applyBadDebtReversal(LOCKED)).rejects.toThrow(FiledYearError);
  });

  test('generateYearEndDepreciation', async () => {
    await expect(generateYearEndDepreciation(LOCKED)).rejects.toThrow(FiledYearError);
  });

  test('generateDisposalEntry は除却日の年度で判定する', async () => {
    const id = await seedDisposedAsset(`${LOCKED}-06-30`);
    await expect(generateDisposalEntry(id)).rejects.toThrow(FiledYearError);
  });

  test('generateOpeningEntries', async () => {
    await expect(
      generateOpeningEntries({
        businessStartDate: `${LOCKED}-04-01`,
        expenses: [],
        expenseAmortization: 'immediate',
        convertedAssets: [],
        customItems: [],
      }),
    ).rejects.toThrow(FiledYearError);
  });

  test('removeOpeningEntries', async () => {
    await expect(removeOpeningEntries(LOCKED)).rejects.toThrow(FiledYearError);
  });
});

describe('未申告年度と、確認を通った呼出は通す', () => {
  test('未申告年度なら止めない', async () => {
    const date = `${LOCKED - 1}-05-01`;
    await expect(commitImport(importInfo(date), [importRow(date)])).resolves.toMatchObject({
      entryCount: 1,
    });
  });

  test('allowFiledYear を明示した呼出は通す', async () => {
    const date = `${LOCKED}-05-01`;
    await expect(
      commitImport(importInfo(date), [importRow(date)], { allowFiledYear: true }),
    ).resolves.toMatchObject({ entryCount: 1 });
    expect(await db.journalEntries.count()).toBe(1);
  });

  test('除却日が未申告年度なら止めない', async () => {
    const id = await seedDisposedAsset(`${LOCKED - 1}-06-30`);
    // 生成できるかは資産の状態次第だが、ロックで弾かれないことがここの主張。
    await expect(generateDisposalEntry(id)).resolves.toBeDefined();
  });
});
