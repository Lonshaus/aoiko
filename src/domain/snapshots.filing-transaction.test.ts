import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Dexie from 'dexie';
import { db } from '../db/db';
import type { JournalEntry, JournalLine, ReportSnapshotData } from '../db/types';
import { toIndexable } from '../lib/decimal';
import {
  getSetting,
  loadSmallAmountSpecialInputs,
  loadWariBaseAdjustments,
  loadWariEligibilityInputs,
  setSetting,
} from '../lib/settings';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { compareAll } from './consumption-tax';
import { buildAll, buildPL, type MonthlyReport, type PLReport } from './reports';
import { getConsumptionTaxSnapshot, markYearFiled, runFilingTransaction } from './snapshots';
import { FiledYearError } from './year-lock';

const YEAR = 2026;

function saleEntry(id: string): JournalEntry {
  return {
    id,
    date: `${YEAR}-05-01`,
    year: YEAR,
    description: '売上',
    status: 'confirmed',
    source: 'manual',
    createdAt: 1,
    confirmedAt: 1,
  };
}

function saleLines(entryId: string, amount: string): JournalLine[] {
  const base = {
    entryId,
    amount,
    amountIndexed: toIndexable(amount),
    taxRate: 0.1,
    taxIncluded: true,
    invoiceCompliant: false,
  };
  return [
    { ...base, id: `${entryId}-d`, side: 'debit', accountCode: '1110' },
    { ...base, id: `${entryId}-c`, side: 'credit', accountCode: '4110' },
  ];
}

async function seedSale(id: string, amount: string): Promise<void> {
  await db.journalEntries.add(saleEntry(id));
  await db.journalLines.bulkAdd(saleLines(id, amount));
}

function payloads(
  monthly: MonthlyReport,
  pl: PLReport,
): {
  monthlySales: ReportSnapshotData & { type: 'monthly-sales' };
  pl: ReportSnapshotData & { type: 'pl' };
} {
  return {
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
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((r) => {
    resolve = () => r();
  });
  return { promise, resolve };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function openNative(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
// 門を通らない書き込み。別のタブから素の IndexedDB で書くのと同じ。
function writeNative(conn: IDBDatabase, entryId: string, amount: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = conn.transaction(['journalEntries', 'journalLines'], 'readwrite');
    tx.objectStore('journalEntries').put(saleEntry(entryId));
    for (const line of saleLines(entryId, amount)) {
      tx.objectStore('journalLines').put(line);
    }
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}

let native: IDBDatabase | null = null;
let releaseHold: (() => void) | null = null;
let heldFiling: Promise<unknown> | null = null;
// 集計の後で止めた申告の取引。release を呼ぶまで申告記録は書かれない。
function startHeldFiling(): { started: Promise<void>; release: () => void; filing: Promise<void> } {
  const started = deferred();
  const released = deferred();
  releaseHold = released.resolve;
  const filing = runFilingTransaction(async () => {
    const { monthly, pl } = await buildAll(YEAR, 'department');
    // 取引の中で解決すると、待っているテスト本体まで取引の文脈を引き継ぎ、確定後の読み込みが失敗する。
    Dexie.ignoreTransaction(() => started.resolve());
    await Dexie.waitFor(released.promise);
    await markYearFiled(YEAR, payloads(monthly, pl), `${YEAR}-12-31`);
  });
  heldFiling = filing;
  return { started: started.promise, release: released.resolve, filing };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.accounts.bulkAdd(ACCOUNTS_2026);
  await seedSale('seed', '1000');
});

afterEach(async () => {
  releaseHold?.();
  await heldFiling?.catch(() => {});
  releaseHold = null;
  heldFiling = null;
  native?.close();
  native = null;
  await db.delete();
});

describe('runFilingTransaction', () => {
  test('申告時の集計と消費税の読み込みが、すべて取引の範囲に収まる', async () => {
    await setSetting('taxRegistration', 'taxable');
    await runFilingTransaction(async () => {
      const { monthly, pl } = await buildAll(YEAR, 'department');
      await getSetting('simplifiedTaxCategory');
      await getConsumptionTaxSnapshot(YEAR - 1);
      await loadWariEligibilityInputs();
      await loadSmallAmountSpecialInputs();
      await loadWariBaseAdjustments(YEAR);
      const results = await compareAll(YEAR, 4, 'proportional', {});
      const first = results[0];
      if (!first) {
        throw new Error('消費税の計算結果が無い');
      }
      await markYearFiled(
        YEAR,
        {
          ...payloads(monthly, pl),
          consumptionTax: {
            type: 'consumption-tax',
            data: { method: first.method, netTaxNational: first.filingRounded.national },
          },
        },
        `${YEAR}-12-31`,
      );
    });
    const filed = await db.reportSnapshots.where('year').equals(YEAR).toArray();
    expect(filed.map((s) => s.type).sort()).toEqual(['consumption-tax', 'monthly-sales', 'pl']);
    expect(filed.every((s) => s.status === 'filed')).toBe(true);
  });

  test('申告中に別の接続から書いた仕訳は、申告の確定まで待たされ、申告記録に入らない', async () => {
    const before = (await buildPL(YEAR)).totalRevenue;
    const { started, release, filing } = startHeldFiling();
    await started;
    native = await openNative(db.name);
    let nativeDone = false;
    const nativeWrite = writeNative(native, 'native', '1000').then(() => {
      nativeDone = true;
    });
    await sleep(50);
    expect(nativeDone).toBe(false);
    release();
    await filing;
    await nativeWrite;
    expect(nativeDone).toBe(true);
    const filedPl = await db.reportSnapshots
      .where('[year+type+status]')
      .equals([YEAR, 'pl', 'filed'])
      .first();
    expect(filedPl?.payload.type === 'pl' ? filedPl.payload.data.totalRevenue : null).toBe(before);
    expect(before).toBe('1000');
    expect((await buildPL(YEAR)).totalRevenue).toBe('2000');
  });

  test('申告中に門を通して書いた仕訳は、申告の確定後に申告済みとして止まり、何も書かれない', async () => {
    const { started, release, filing } = startHeldFiling();
    await started;
    let guardedSettled = false;
    const guarded = Dexie.ignoreTransaction(() =>
      db.transaction('rw', [db.journalEntries, db.journalLines, db.reportSnapshots], async () => {
        await db.journalEntries.add(saleEntry('late'));
        await db.journalLines.bulkAdd(saleLines('late', '1000'));
      }),
    );
    const outcome = guarded.then(
      () => {
        guardedSettled = true;
        return null;
      },
      (e: unknown) => {
        guardedSettled = true;
        return e;
      },
    );
    await sleep(50);
    expect(guardedSettled).toBe(false);
    release();
    await filing;
    expect(await outcome).toBeInstanceOf(FiledYearError);
    expect(await db.journalEntries.get('late')).toBeUndefined();
    expect(await db.journalLines.where('entryId').equals('late').count()).toBe(0);
  });
});
