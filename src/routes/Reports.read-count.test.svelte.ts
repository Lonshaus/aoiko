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
