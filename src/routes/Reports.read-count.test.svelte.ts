// レポート画面の liveQuery が同一年度の仕訳明細を 1 回しか読まないこと、
// 分析軸の切替で主クエリが再実行されないことを見る。
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { setSetting } from '../lib/settings';
import { toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { markYearFiled } from '../domain/snapshots';
import { allowFiledYearWriteInThisTransaction } from '../db/filed-year-guard';
import { ledger } from '../stores/ledger.svelte';
import { m } from '../paraglide/messages';
import type { Account } from '../db/types';

vi.mock('../lib/save-file', () => ({
  saveTextFile: vi.fn(async () => 'saved' as const),
}));

const { default: Reports } = await import('./Reports.svelte');

const YEAR = 2026;
const VENDOR_NAME = '計数テスト商店';
const DEPARTMENT_NAME = '計数テスト部門';

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;
let whereSpy: MockInstance<typeof db.journalLines.where> | undefined;
let yearEntryIds = new Set<string>();
let fullReads = 0;

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

interface AnyOfClause {
  anyOf: (...a: unknown[]) => unknown;
}

function installReadCounter(): void {
  const originalWhere = db.journalLines.where.bind(db.journalLines) as unknown as (
    ...args: unknown[]
  ) => AnyOfClause;
  whereSpy = vi.spyOn(db.journalLines, 'where').mockImplementation(((...args: unknown[]) => {
    const clause = originalWhere(...args);
    const originalAnyOf = clause.anyOf.bind(clause);
    clause.anyOf = (...a: unknown[]) => {
      const ids = Array.isArray(a[0]) ? (a[0] as string[]) : (a as string[]);
      if (sameSet(new Set(ids), yearEntryIds)) {
        fullReads++;
      }
      return originalAnyOf(...a);
    };
    return clause;
  }) as unknown as typeof db.journalLines.where);
}

async function seedEntry(date: string, vendorId: string, department: string): Promise<string> {
  const entryId = newId();
  const now = Date.now();
  await db.journalEntries.add({
    id: entryId,
    date,
    year: YEAR,
    description: '売上',
    status: 'confirmed',
    source: 'manual',
    createdAt: now,
    confirmedAt: now,
    department,
  });
  await db.journalLines.bulkAdd(
    (['debit', 'credit'] as const).map((side) => ({
      id: newId(),
      entryId,
      side,
      accountCode: side === 'debit' ? '1130' : '4110',
      ...(side === 'credit' ? { vendorId } : {}),
      amount: '110000',
      amountIndexed: toIndexable('110000'),
      taxRate: side === 'credit' ? 0.1 : 0,
      taxIncluded: true,
      invoiceCompliant: false,
    })),
  );
  return entryId;
}

function breakdownText(): string {
  return container?.textContent ?? '';
}

beforeEach(async () => {
  fullReads = 0;
  await db.delete();
  await db.open();
  const accs: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year: YEAR }));
  await db.accounts.bulkPut(accs);
  const vendorId = newId();
  await db.vendors.add({ id: vendorId, name: VENDOR_NAME });
  const ids: string[] = [];
  for (let i = 0; i < 12; i++) {
    const month = i < 6 ? '03' : '04';
    ids.push(await seedEntry(`${YEAR}-${month}-${String(i + 10)}`, vendorId, DEPARTMENT_NAME));
  }
  yearEntryIds = new Set(ids);
  await setSetting('taxRegistration', 'taxable');
  await setSetting('simplifiedTaxCategory', 4);
  await setSetting('simplifiedElectionFiledDate', '2025-06-01');
  await setSetting('inventoryAutoValuationEnabled', false);
  await setSetting('currentYear', YEAR);
  await markYearFiled(
    YEAR,
    {
      monthlySales: { type: 'monthly-sales', data: { months: [] } },
      pl: { type: 'pl', data: { rows: [], totalRevenue: '0', totalExpense: '0', netIncome: '0' } },
      bs: { type: 'bs', data: { assets: [], liabilities: [], equity: [] } },
    },
    `${YEAR}-12-31`,
  );
  await waitFor(
    () =>
      ledger.currentYear === YEAR &&
      ledger.inventoryAutoValuationEnabled === false &&
      ledger.recentLedgerRows.length === 10,
  );
  await sleep(200);
});

afterEach(async () => {
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  if (container !== undefined) {
    container.remove();
    container = undefined;
  }
  whereSpy?.mockRestore();
  whereSpy = undefined;
  await db.delete();
});

describe('レポート画面の年度データ読み込み回数', () => {
  test('開いたときは 1 回、分析軸を切り替えても増えず、内訳は新しい軸の結果になる', async () => {
    installReadCounter();
    fullReads = 0;

    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });

    await waitFor(() => breakdownText().includes(VENDOR_NAME));
    await sleep(300);
    expect(fullReads).toBe(1);

    const departmentButton = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes(m.reports_breakdown_by_department()),
    )!;
    departmentButton.click();
    await waitFor(() => breakdownText().includes(DEPARTMENT_NAME));
    await sleep(300);

    expect(breakdownText()).not.toContain(VENDOR_NAME);
    expect(fullReads).toBe(1);
  });
});

interface IdbRead {
  store: string;
  keys: unknown[];
}

// journalEntries と journalLines に対する IDB の読み取り呼び出しを、返した行（key）ごとに記録する。
function installIdbRecorder(): { reads: IdbRead[]; restore: () => void } {
  const reads: IdbRead[] = [];
  const methods = ['getAll', 'getAllKeys', 'openCursor', 'openKeyCursor', 'get', 'getKey'];
  const restores: Array<() => void> = [];
  const wrap = (proto: Record<string, unknown>, storeOf: (self: unknown) => string): void => {
    for (const method of methods) {
      const orig = proto[method] as ((...a: unknown[]) => IDBRequest) | undefined;
      if (typeof orig !== 'function') {
        continue;
      }
      proto[method] = function (this: unknown, ...args: unknown[]) {
        const store = storeOf(this);
        const req = orig.apply(this, args);
        if (store !== 'journalEntries' && store !== 'journalLines') {
          return req;
        }
        const rec: IdbRead = { store, keys: [] };
        reads.push(rec);
        req.addEventListener('success', () => {
          const r = req.result as unknown;
          if (r === undefined || r === null) {
            return;
          }
          if (method === 'getAll') {
            rec.keys.push(...(r as Array<{ id: unknown }>).map((v) => v.id));
          } else if (method === 'getAllKeys') {
            rec.keys.push(...(r as unknown[]));
          } else if (method === 'openCursor' || method === 'openKeyCursor') {
            rec.keys.push((r as IDBCursor).primaryKey);
          } else if (method === 'get') {
            rec.keys.push((r as { id: unknown }).id);
          } else {
            rec.keys.push(r);
          }
        });
        return req;
      };
      restores.push(() => {
        proto[method] = orig;
      });
    }
  };
  wrap(
    IDBObjectStore.prototype as unknown as Record<string, unknown>,
    (self) => (self as IDBObjectStore).name,
  );
  wrap(
    IDBIndex.prototype as unknown as Record<string, unknown>,
    (self) => (self as IDBIndex).objectStore.name,
  );
  return { reads, restore: () => restores.forEach((f) => f()) };
}

// 1 回の呼び出しが返した行に、その年の行が 1 つでも含まれれば、その年の読み取り 1 回と数える。
function readsOfYear(
  reads: IdbRead[],
  store: string,
  yearOf: Map<unknown, number>,
  year: number,
): number {
  return reads.filter((r) => r.store === store && r.keys.some((k) => yearOf.get(k) === year))
    .length;
}

describe('在庫の自動評価が有効で繰越仕訳がある場合の年度データ読み込み回数', () => {
  test('同じ年の仕訳と明細を 1 回ずつ読み、分析軸を切り替えても読まない', async () => {
    const entryYear = new Map<unknown, number>();
    const lineYear = new Map<unknown, number>();
    for (const e of await db.journalEntries.toArray()) {
      entryYear.set(e.id, e.year);
    }
    for (const l of await db.journalLines.toArray()) {
      lineYear.set(l.id, entryYear.get(l.entryId) ?? 0);
    }
    const add = async (
      id: string,
      date: string,
      year: number,
      source: 'manual' | 'carryover',
      lines: Array<{ side: 'debit' | 'credit'; code: string; withItem?: boolean }>,
    ): Promise<void> => {
      const now = Date.now();
      await db.transaction('rw', db.journalEntries, db.journalLines, async () => {
        allowFiledYearWriteInThisTransaction();
        await db.journalEntries.add({
          id,
          date,
          year,
          description: '計数テスト',
          status: 'confirmed',
          source,
          createdAt: now,
          confirmedAt: now,
        });
        await db.journalLines.bulkAdd(
          lines.map((l, i) => ({
            id: `${id}-l${i}`,
            entryId: id,
            side: l.side,
            accountCode: l.code,
            amount: '50000',
            amountIndexed: toIndexable('50000'),
            taxRate: 0,
            taxIncluded: true,
            invoiceCompliant: false,
            ...(l.withItem ? { itemId: 'item-a', quantity: '5' } : {}),
          })),
        );
      });
      entryYear.set(id, year);
      for (let i = 0; i < lines.length; i++) {
        lineYear.set(`${id}-l${i}`, year);
      }
    };
    await db.accounts.bulkPut(ACCOUNTS_2026.map((a) => ({ ...a, year: 2025 }) as Account));
    await add('a25-p', '2025-05-01', 2025, 'manual', [
      { side: 'debit', code: '5020', withItem: true },
      { side: 'credit', code: '1130' },
    ]);
    await add('b26-carry', '2026-01-01', 2026, 'carryover', [
      { side: 'debit', code: '1130' },
      { side: 'credit', code: '3110' },
    ]);
    await add('b26-p', '2026-02-01', 2026, 'manual', [
      { side: 'debit', code: '5020', withItem: true },
      { side: 'credit', code: '1130' },
    ]);
    await setSetting('inventoryAutoValuationEnabled', true);
    await waitFor(() => ledger.inventoryAutoValuationEnabled === true);
    await sleep(200);

    const recorder = installIdbRecorder();
    try {
      container = document.createElement('div');
      document.body.appendChild(container);
      instance = mount(Reports, { target: container, props: {} });
      await waitFor(() => breakdownText().includes(VENDOR_NAME));
      await sleep(500);
      expect(breakdownText()).toContain(m.reports_pl_inventory_suggestion_title());
      expect(readsOfYear(recorder.reads, 'journalEntries', entryYear, YEAR)).toBe(1);
      expect(readsOfYear(recorder.reads, 'journalLines', lineYear, YEAR)).toBe(1);

      recorder.reads.length = 0;
      const departmentButton = Array.from(container.querySelectorAll('button')).find((b) =>
        (b.textContent ?? '').includes(m.reports_breakdown_by_department()),
      )!;
      departmentButton.click();
      await waitFor(() => breakdownText().includes(DEPARTMENT_NAME));
      await sleep(300);
      expect(recorder.reads.filter((r) => r.keys.length > 0)).toHaveLength(0);
    } finally {
      recorder.restore();
    }
  });
});
