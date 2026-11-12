import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { PAYLOAD_VERSION } from '../backup';
import { D, toIndexable } from '../lib/decimal';
import { setSetting } from '../lib/settings';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { compareAll } from './consumption-tax';
import { buildAll } from './reports';
import { restoreFromJson } from './restore';
import { BackupValidationError } from './restore-validate';
import {
  markYearFiled,
  runFilingTransaction,
  unlockYear,
  usesLegacyPurchaseAssetRule,
} from './snapshots';
import type { JournalLine, ReportSnapshot, ReportSnapshotData } from '../db/types';

const YEAR = 2026;
const SMALL_AMOUNT_SPECIAL = { basePeriodSales: D(50_000_000) };
const LEGACY_NET_TAX_NATIONAL = '6300';
const CURRENT_NET_TAX_NATIONAL = '7500';

const PL: ReportSnapshotData & { type: 'pl' } = {
  type: 'pl',
  data: { rows: [], totalRevenue: '0', totalExpense: '0', netIncome: '0' },
};
const MONTHLY: ReportSnapshotData & { type: 'monthly-sales' } = {
  type: 'monthly-sales',
  data: { months: [] },
};
const BS: ReportSnapshotData & { type: 'bs' } = {
  type: 'bs',
  data: { assets: [], liabilities: [], equity: [] },
};
const CONSUMPTION_TAX: ReportSnapshotData & { type: 'consumption-tax' } = {
  type: 'consumption-tax',
  data: { method: 'general', netTaxNational: '0' },
};

function snapshot(overrides: Partial<ReportSnapshot> & Pick<ReportSnapshot, 'id'>): ReportSnapshot {
  return {
    year: YEAR,
    type: 'pl',
    status: 'filed',
    filedAt: 1,
    payload: PL,
    generatedAt: 1,
    generatedFromEntriesUpTo: `${YEAR}-12-31`,
    ...overrides,
  };
}

type LineSeed = Partial<JournalLine> & Pick<JournalLine, 'id' | 'side' | 'accountCode' | 'amount'>;

async function seedEntry(id: string, date: string, lines: LineSeed[]): Promise<void> {
  await db.journalEntries.add({
    id,
    date,
    year: Number(date.slice(0, 4)),
    description: 'テスト',
    status: 'confirmed',
    source: 'manual',
    createdAt: 0,
    confirmedAt: 0,
  });
  await db.journalLines.bulkAdd(
    lines.map((l) => ({
      entryId: id,
      amountIndexed: toIndexable(l.amount),
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
      ...l,
    })),
  );
}

async function seedPurchaseWithDeposit(): Promise<void> {
  await seedEntry('sale', '2026-03-01', [
    { id: 'sale-d', side: 'debit', accountCode: '1130', amount: '110000' },
    { id: 'sale-c', side: 'credit', accountCode: '4110', amount: '110000', taxRate: 0.1 },
  ]);
  await seedEntry('buy', '2026-04-01', [
    { id: 'expense', side: 'debit', accountCode: '5150', amount: '3300', taxRate: 0.1 },
    { id: 'deposit', side: 'debit', accountCode: '1130', amount: '22000', taxRate: 0.1 },
    { id: 'buy-c', side: 'credit', accountCode: '3120', amount: '25300' },
  ]);
}

async function filedRows(): Promise<ReportSnapshot[]> {
  return db.reportSnapshots
    .where('year')
    .equals(YEAR)
    .filter((s) => s.status === 'filed')
    .toArray();
}
// 報告画面のロックと同じ順序で、取引の中で計算してから申告記録を書く
async function relockLikeReports(): Promise<void> {
  await runFilingTransaction(async () => {
    const { monthly, pl } = await buildAll(YEAR, 'department');
    if (!monthly || !pl) {
      throw new Error('集計できない');
    }
    const results = await compareAll(YEAR, 4, 'proportional', {
      smallAmountSpecial: SMALL_AMOUNT_SPECIAL,
      sequential: true,
    });
    const general = results.find((r) => r.method === 'general');
    if (!general) {
      throw new Error('本則課税の結果が無い');
    }
    await markYearFiled(
      YEAR,
      {
        monthlySales: {
          type: 'monthly-sales',
          data: { months: monthly.months.map((m) => ({ month: m.month, sales: m.sales })) },
        },
        pl: {
          type: 'pl',
          data: {
            rows: [...pl.revenue, ...pl.expense].map((r) => ({
              accountCode: r.accountCode,
              amount: r.amount,
            })),
            totalRevenue: pl.totalRevenue,
            totalExpense: pl.totalExpense,
            netIncome: pl.netIncome,
          },
        },
        consumptionTax: {
          type: 'consumption-tax',
          data: { method: general.method, netTaxNational: general.filingRounded.national },
        },
      },
      `${YEAR}-12-31`,
    );
  });
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.accounts.bulkAdd(ACCOUNTS_2026);
});

afterEach(async () => {
  await db.delete();
});

describe('usesLegacyPurchaseAssetRule', () => {
  test('申告記録が無い年分は今の判定', async () => {
    expect(await usesLegacyPurchaseAssetRule(YEAR)).toBe(false);
  });

  test('印の無い filed の損益計算書の記録がある年分は申告時の判定', async () => {
    await db.reportSnapshots.add(snapshot({ id: 'pl' }));
    expect(await usesLegacyPurchaseAssetRule(YEAR)).toBe(true);
  });

  test('印のある filed の損益計算書の記録だけなら今の判定', async () => {
    await db.reportSnapshots.add(snapshot({ id: 'pl', excludesNonPurchaseAssets: true }));
    expect(await usesLegacyPurchaseAssetRule(YEAR)).toBe(false);
  });

  test('印の無い superseded の記録が残っていれば、印のある filed があっても申告時の判定', async () => {
    await db.reportSnapshots.bulkAdd([
      snapshot({ id: 'old', status: 'superseded' }),
      snapshot({ id: 'new', excludesNonPurchaseAssets: true }),
    ]);
    expect(await usesLegacyPurchaseAssetRule(YEAR)).toBe(true);
  });

  test('印の無い消費税の記録があっても、損益計算書の記録に印があれば今の判定', async () => {
    await db.reportSnapshots.bulkAdd([
      snapshot({ id: 'ct', type: 'consumption-tax', payload: CONSUMPTION_TAX }),
      snapshot({ id: 'pl', excludesNonPurchaseAssets: true }),
    ]);
    expect(await usesLegacyPurchaseAssetRule(YEAR)).toBe(false);
  });

  test('印が false の記録は印が無いものとして扱う', async () => {
    await db.reportSnapshots.add(snapshot({ id: 'pl', excludesNonPurchaseAssets: false }));
    expect(await usesLegacyPurchaseAssetRule(YEAR)).toBe(true);
  });

  test('ほかの年分の印の無い記録は影響しない', async () => {
    await db.reportSnapshots.bulkAdd([
      snapshot({ id: 'prev', year: YEAR - 1 }),
      snapshot({ id: 'next', year: YEAR + 1, status: 'superseded' }),
    ]);
    expect(await usesLegacyPurchaseAssetRule(YEAR)).toBe(false);
  });
});

describe('markYearFiled の印', () => {
  test('申告記録の無い年分は、書き込む記録すべてに印を付ける', async () => {
    await markYearFiled(
      YEAR,
      { monthlySales: MONTHLY, pl: PL, bs: BS, consumptionTax: CONSUMPTION_TAX },
      `${YEAR}-12-31`,
    );
    const rows = await filedRows();
    expect(rows.map((r) => r.type).sort()).toEqual([
      'bs',
      'consumption-tax',
      'monthly-sales',
      'pl',
    ]);
    expect(rows.every((r) => r.excludesNonPurchaseAssets === true)).toBe(true);
  });

  test('印の無い superseded の損益計算書の記録がある年分は、どの記録にも印を付けない', async () => {
    await db.reportSnapshots.add(snapshot({ id: 'old', status: 'superseded' }));
    await markYearFiled(
      YEAR,
      { monthlySales: MONTHLY, pl: PL, bs: BS, consumptionTax: CONSUMPTION_TAX },
      `${YEAR}-12-31`,
    );
    const rows = await filedRows();
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => !Object.hasOwn(r, 'excludesNonPurchaseAssets'))).toBe(true);
  });
});

describe('ロック解除から再ロックまで', () => {
  async function seedFiledYear(marked: boolean): Promise<void> {
    await seedPurchaseWithDeposit();
    await setSetting('taxRegistration', 'taxable');
    const mark: Partial<ReportSnapshot> = marked ? { excludesNonPurchaseAssets: true } : {};
    await db.reportSnapshots.bulkAdd([
      snapshot({ id: 'pl', ...mark }),
      snapshot({ id: 'ct', type: 'consumption-tax', payload: CONSUMPTION_TAX, ...mark }),
    ]);
  }

  test('印の無い申告をやり直すと、申告時の判定で計算し、印を付けない', async () => {
    await seedFiledYear(false);

    await unlockYear(YEAR);
    await relockLikeReports();

    const ct = (await filedRows()).find((r) => r.type === 'consumption-tax');
    expect(ct).toBeDefined();
    expect(Object.hasOwn(ct!, 'excludesNonPurchaseAssets')).toBe(false);
    const national = ct!.payload.type === 'consumption-tax' ? ct!.payload.data.netTaxNational : '';
    expect(national).toBe(LEGACY_NET_TAX_NATIONAL);
    expect(national).not.toBe(CURRENT_NET_TAX_NATIONAL);
  });

  test('印のある申告をやり直すと、今の判定で計算し、印を付ける', async () => {
    await seedFiledYear(true);

    await unlockYear(YEAR);
    await relockLikeReports();

    const ct = (await filedRows()).find((r) => r.type === 'consumption-tax');
    expect(ct?.excludesNonPurchaseAssets).toBe(true);
    const national = ct?.payload.type === 'consumption-tax' ? ct.payload.data.netTaxNational : '';
    expect(national).toBe(CURRENT_NET_TAX_NATIONAL);
  });
});

describe('バックアップの復元と印', () => {
  function backupWith(row: Record<string, unknown>): Parameters<typeof restoreFromJson>[0] {
    return {
      version: PAYLOAD_VERSION,
      exportedAt: '2026-11-04',
      tables: {
        reportSnapshots: [
          {
            id: 'rs1',
            year: YEAR,
            type: 'pl',
            status: 'filed',
            payload: PL,
            generatedAt: 1,
            generatedFromEntriesUpTo: `${YEAR}-12-31`,
            ...row,
          },
        ],
      },
    };
  }

  test('印 true は検査を通り、復元後も true のまま', async () => {
    await restoreFromJson(backupWith({ excludesNonPurchaseAssets: true }));
    expect((await db.reportSnapshots.get('rs1'))?.excludesNonPurchaseAssets).toBe(true);
    expect(await usesLegacyPurchaseAssetRule(YEAR)).toBe(false);
  });

  test('印が真偽値でなければ復元しない', async () => {
    await expect(
      restoreFromJson(backupWith({ excludesNonPurchaseAssets: 'yes' })),
    ).rejects.toBeInstanceOf(BackupValidationError);
    expect(await db.reportSnapshots.count()).toBe(0);
  });

  test('印の欄が無い古いバックアップも復元でき、申告時の判定の年分になる', async () => {
    await restoreFromJson(backupWith({}));
    const row = await db.reportSnapshots.get('rs1');
    expect(row).toBeDefined();
    expect(Object.hasOwn(row!, 'excludesNonPurchaseAssets')).toBe(false);
    expect(await usesLegacyPurchaseAssetRule(YEAR)).toBe(true);
  });
});
