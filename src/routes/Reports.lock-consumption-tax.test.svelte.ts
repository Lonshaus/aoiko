// 年度ロック時に消費税の確定額（方式・国税の差引税額）を保存し、翌年の画面がそれを読むことを見る。
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { setSetting } from '../lib/settings';
import { D, toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { getConsumptionTaxSnapshot, isYearLocked, markYearFiled } from '../domain/snapshots';
import { m } from '../paraglide/messages';
import type { Account } from '../db/types';

vi.mock('../lib/save-file', () => ({
  saveTextFile: vi.fn(async () => 'saved' as const),
}));

const { compareAllSpy, failure } = vi.hoisted(() => ({
  compareAllSpy: vi.fn(),
  failure: { on: false },
}));

vi.mock('../domain/consumption-tax', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/consumption-tax')>();
  compareAllSpy.mockImplementation((...args: Parameters<typeof actual.compareAll>) => {
    if (failure.on) {
      return Promise.reject(new Error('compareAll failed'));
    }
    return actual.compareAll(...args);
  });
  return { ...actual, compareAll: compareAllSpy };
});

const { default: Reports } = await import('./Reports.svelte');
const { compareAll } = await vi.importActual<typeof import('../domain/consumption-tax')>(
  '../domain/consumption-tax',
);

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function seedAccounts(year: number): Promise<void> {
  const accs: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year }));
  await db.accounts.bulkPut(accs);
}

async function seedSale(year: number, amount: string): Promise<void> {
  const entryId = newId();
  const now = Date.now();
  await db.journalEntries.add({
    id: entryId,
    date: `${year}-06-15`,
    year,
    description: '売上',
    status: 'confirmed',
    source: 'manual',
    createdAt: now,
    confirmedAt: now,
  });
  await db.journalLines.bulkAdd(
    (['debit', 'credit'] as const).map((side) => ({
      id: newId(),
      entryId,
      side,
      accountCode: side === 'debit' ? '1130' : '4110',
      amount,
      amountIndexed: toIndexable(amount),
      taxRate: side === 'credit' ? 0.1 : 0,
      taxIncluded: true,
      invoiceCompliant: false,
    })),
  );
}

function bodyButton(label: string): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(label),
  );
  if (found === undefined) {
    throw new Error(`ボタンが見つからない: ${label}`);
  }
  return found;
}

function lockMethodSelect(): HTMLSelectElement | null {
  return document.body.querySelector<HTMLSelectElement>('[data-testid="lock-method-select"]');
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function mountReports(): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Reports, { target: container, props: {} });
  return container;
}

async function openLockDialog(c: HTMLElement): Promise<void> {
  await waitFor(() => (c.textContent ?? '').includes(m.reports_lock_button()));
  const btn = Array.from(c.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(m.reports_lock_button()),
  )!;
  btn.click();
  await waitFor(() => (document.body.textContent ?? '').includes(m.reports_lock_confirm_action()));
}

beforeEach(async () => {
  failure.on = false;
  await db.delete();
  await db.open();
  await seedAccounts(2026);
  await seedAccounts(2027);
  await setSetting('currentYear', 2026);
  await setSetting('simplifiedTaxCategory', 4);
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
  await db.delete();
  compareAllSpy.mockClear();
});

describe('年度ロック：消費税の確定額の保存', () => {
  test('課税事業者：選んだ方式と、その方式の国税の申告書相当額を保存する', async () => {
    await setSetting('taxRegistration', 'taxable');
    await seedSale(2026, '1100000');
    const results = await compareAll(2026, 4, 'proportional', {});
    const general = results.find((r) => r.method === 'general')!;
    const best = results.reduce((a, b) => (D(b.netTax.total).lessThan(D(a.netTax.total)) ? b : a));
    expect(best.method).not.toBe('general');

    const c = mountReports();
    await openLockDialog(c);
    await waitFor(() => lockMethodSelect() !== null);
    const select = lockMethodSelect()!;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(
      expect.arrayContaining(['general', 'simplified']),
    );
    expect(select.value).toBe(best.method);

    select.value = 'general';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    bodyButton(m.reports_lock_confirm_action()).click();
    await waitFor(() => c.textContent!.includes(m.reports_filed_badge()));

    const snap = await getConsumptionTaxSnapshot(2026);
    expect(snap).toEqual({ method: 'general', netTaxNational: general.filingRounded.national });
    expect(await isYearLocked(2026)).toBe(true);
  });

  test('選択を変えずに確定すると、最少納付額の方式が保存される', async () => {
    await setSetting('taxRegistration', 'taxable');
    await seedSale(2026, '1100000');
    const results = await compareAll(2026, 4, 'proportional', {});
    const best = results.reduce((a, b) => (D(b.netTax.total).lessThan(D(a.netTax.total)) ? b : a));

    const c = mountReports();
    await openLockDialog(c);
    bodyButton(m.reports_lock_confirm_action()).click();
    await waitFor(() => c.textContent!.includes(m.reports_filed_badge()));

    expect(await getConsumptionTaxSnapshot(2026)).toEqual({
      method: best.method,
      netTaxNational: best.filingRounded.national,
    });
  });

  test('免税事業者：選択欄は出ず、消費税の確定額は保存しない', async () => {
    await setSetting('taxRegistration', 'tax-free');
    await seedSale(2026, '1100000');

    const c = mountReports();
    await openLockDialog(c);
    expect(lockMethodSelect()).toBeNull();
    bodyButton(m.reports_lock_confirm_action()).click();
    await waitFor(() => c.textContent!.includes(m.reports_filed_badge()));

    expect(await isYearLocked(2026)).toBe(true);
    expect(await getConsumptionTaxSnapshot(2026)).toBeUndefined();
    expect(c.textContent).not.toContain(m.reports_lock_ct_not_saved());
  });

  test('消費税の計算に失敗しても所得税側はロックし、確定額は保存せず一行の説明を出す', async () => {
    await setSetting('taxRegistration', 'taxable');
    await seedSale(2026, '1100000');

    const c = mountReports();
    await openLockDialog(c);
    failure.on = true;
    bodyButton(m.reports_lock_confirm_action()).click();
    await waitFor(() => c.textContent!.includes(m.reports_lock_ct_not_saved()));

    expect(await isYearLocked(2026)).toBe(true);
    expect(await getConsumptionTaxSnapshot(2026)).toBeUndefined();
  });
});

describe('翌年の Reports が前年の確定額を読む', () => {
  test('前年の netTaxNational が中間申告の前年額に入り、方式が compareAll の priorYearMethod に渡る', async () => {
    await markYearFiled(
      2026,
      {
        monthlySales: { type: 'monthly-sales', data: { months: [] } },
        pl: {
          type: 'pl',
          data: { rows: [], totalRevenue: '0', totalExpense: '0', netIncome: '0' },
        },
        consumptionTax: {
          type: 'consumption-tax',
          data: { method: 'simplified', netTaxNational: '523400' },
        },
      },
      '2026-12-31',
    );
    await setSetting('taxRegistration', 'taxable');
    await setSetting('currentYear', 2027);

    const c = mountReports();
    await waitFor(() => (c.textContent ?? '').includes('2026年分の確定消費税額（国税分）'));
    const label = Array.from(c.querySelectorAll('label')).find((l) =>
      (l.textContent ?? '').includes('2026年分の確定消費税額（国税分）'),
    )!;
    await waitFor(() => label.querySelector('input')?.value === '523400');

    await waitFor(() =>
      compareAllSpy.mock.calls.some(
        (call) => call[0] === 2027 && call[3]?.priorYearMethod === 'simplified',
      ),
    );
  });
});
