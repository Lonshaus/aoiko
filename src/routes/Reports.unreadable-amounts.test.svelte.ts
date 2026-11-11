import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { getSetting, setSetting } from '../lib/settings';
import { newId } from '../lib/id';
import { m } from '../paraglide/messages';
import type { Account, JournalLine } from '../db/types';

vi.mock('../lib/save-file', () => ({
  saveTextFile: vi.fn(async () => 'saved' as const),
}));

const { default: Reports } = await import('./Reports.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const LOAD_ERROR_HEAD = m.reports_load_error({ message: 'ZZZ' }).split('ZZZ')[0]!;

async function seedAccounts(year: number): Promise<void> {
  const accs: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year }));
  await db.accounts.bulkPut(accs);
}

async function seedEntry(opts: {
  id: string;
  date: string;
  description: string;
  debit: string;
  credit: string;
  debitAmount: unknown;
  creditAmount?: unknown;
  source?: 'manual' | 'carryover';
  debitExtras?: Partial<JournalLine>;
}): Promise<void> {
  await db.journalEntries.add({
    id: opts.id,
    date: opts.date,
    year: Number(opts.date.slice(0, 4)),
    description: opts.description,
    status: 'confirmed',
    source: opts.source ?? 'manual',
    createdAt: 1,
    confirmedAt: 1,
  });
  await db.journalLines.bulkAdd(
    (['debit', 'credit'] as const).map((side) => ({
      id: `${opts.id}-${side}`,
      entryId: opts.id,
      side,
      accountCode: side === 'debit' ? opts.debit : opts.credit,
      amount: (side === 'debit'
        ? opts.debitAmount
        : (opts.creditAmount ?? opts.debitAmount)) as string,
      amountIndexed: '00000000000000.00',
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
      ...(side === 'debit' ? (opts.debitExtras ?? {}) : {}),
    })),
  );
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;
const text = () => container?.textContent ?? '';

function mountReports(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Reports, { target: container, props: {} });
}

function unmountReports(): void {
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  container?.remove();
  container = undefined;
}

function buttonByText(
  label: string,
  root: ParentNode = document.body,
): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
}

function field(name: string): HTMLInputElement {
  return container!.querySelector<HTMLInputElement>(`[name="${name}"]`) as HTMLInputElement;
}

function typeInto(el: HTMLInputElement, value: string, change = false): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  if (change) {
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  flushSync();
}

async function snapshotStores(): Promise<string> {
  return JSON.stringify({
    entries: await db.journalEntries.orderBy('id').toArray(),
    lines: await db.journalLines.orderBy('id').toArray(),
    snapshots: await db.reportSnapshots.toArray(),
    settings: await db.settings.orderBy('key').toArray(),
    budgets: await db.budgets.toArray(),
    arAp: await db.arApEntries.toArray(),
  });
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seedAccounts(2025);
  await seedAccounts(2026);
  await setSetting('currentYear', 2026);
  await setSetting('taxRegistration', 'tax-free');
  await seedEntry({
    id: 'ok-2026',
    date: '2026-03-01',
    description: '正常な売上',
    debit: '1130',
    credit: '4110',
    debitAmount: '5000',
  });
});

afterEach(async () => {
  unmountReports();
  await db.delete();
});

function expectUnreadableNotice(position: string): void {
  expect(text()).toContain(m.reports_stored_unreadable());
  expect(text()).toContain(position);
  expect(text()).not.toContain('DecimalError');
  expect(text()).not.toContain(LOAD_ERROR_HEAD);
  expect(buttonByText(m.reports_xtx_download(), container!)).toBeUndefined();
  expect(text().split(position).length - 1).toBe(1);
}

describe('レポート：保存済みの金額を読めないとき', () => {
  test('当年の明細が読めない：通知と位置を示し、原文を出さず、.xtx の入口を出さない', async () => {
    await seedEntry({
      id: 'bad-2026',
      date: '2026-04-01',
      description: '当年の壊れた経費',
      debit: '5150',
      credit: '1130',
      debitAmount: 'abc',
      creditAmount: '1000',
    });
    mountReports();
    await waitFor(
      () => text().includes('当年の壊れた経費') && text().includes(m.reports_stored_unreadable()),
    );
    expectUnreadableNotice('当年の壊れた経費');
  });

  test('前年の明細が読めない（当年に繰越の仕訳がある）：2025 年の明細を示す', async () => {
    await seedEntry({
      id: 'bad-2025',
      date: '2025-05-01',
      description: '前年の壊れた経費',
      debit: '5150',
      credit: '1130',
      debitAmount: 'abc',
      creditAmount: '2000',
    });
    await seedEntry({
      id: 'carry-2026',
      date: '2026-01-01',
      description: '前期繰越',
      debit: '1130',
      credit: '3110',
      debitAmount: '7000',
      source: 'carryover',
    });
    mountReports();
    await waitFor(
      () => text().includes('前年の壊れた経費') && text().includes(m.reports_stored_unreadable()),
    );
    expectUnreadableNotice('前年の壊れた経費');
  });

  test('在庫の自動計算が有効で仕入明細が読めない：通知と位置を示す', async () => {
    await db.inventoryItems.add({ id: 'item-a', name: '試験品A' } as never);
    await seedEntry({
      id: 'bad-purchase',
      date: '2026-03-10',
      description: '壊れた仕入',
      debit: '5020',
      credit: '1130',
      debitAmount: 'abc',
      creditAmount: '1000',
      debitExtras: { itemId: 'item-a', quantity: '1' },
    });
    mountReports();
    await waitFor(
      () => text().includes('壊れた仕入') && text().includes(m.reports_stored_unreadable()),
    );
    expectUnreadableNotice('壊れた仕入');
  });

  test('復旧の順序：エラー状態を確かめ、明細を直し、開き直すとレポートが出る', async () => {
    await seedEntry({
      id: 'bad-2026',
      date: '2026-04-01',
      description: '当年の壊れた経費',
      debit: '5150',
      credit: '1130',
      debitAmount: 'abc',
      creditAmount: '1000',
    });
    mountReports();
    await waitFor(() => text().includes('当年の壊れた経費'));
    expect(text()).toContain(m.reports_stored_unreadable());
    await db.journalLines.update('bad-2026-debit', { amount: '1000' });
    await new Promise((r) => setTimeout(r, 200));
    expect(text()).toContain(m.reports_stored_unreadable());
    unmountReports();
    mountReports();
    await waitFor(() => buttonByText(m.reports_xtx_download(), container!) !== undefined);
    expect(text()).not.toContain(m.reports_stored_unreadable());
    expect(text()).not.toContain('当年の壊れた経費');
  });

  test('明細が読めなくても、他の読み込み失敗は従来の文言のまま', async () => {
    mountReports();
    await waitFor(() => buttonByText(m.reports_xtx_download(), container!) !== undefined);
    expect(text()).not.toContain(m.reports_stored_unreadable());
  });
});

describe('レポート：複数年度の推移', () => {
  async function runTrend(): Promise<void> {
    await waitFor(() => buttonByText(m.reports_trend_run(), container!) !== undefined);
    typeInto(field('trendStartNen'), '2025');
    typeInto(field('trendEndNen'), '2026');
    buttonByText(m.reports_trend_run(), container!)!.click();
  }

  test('前年の明細が読めないとき、推移の誤りを示し、未処理の rejection も原文も出さない', async () => {
    const rejections: unknown[] = [];
    const onRejection = (e: PromiseRejectionEvent) => rejections.push(e.reason);
    window.addEventListener('unhandledrejection', onRejection);
    try {
      await seedEntry({
        id: 'bad-2025',
        date: '2025-05-01',
        description: '前年の壊れた経費',
        debit: '5150',
        credit: '1130',
        debitAmount: 'abc',
        creditAmount: '2000',
      });
      mountReports();
      await runTrend();
      await waitFor(() => text().includes(m.common_stored_amount_error()));
      expect(container!.querySelector('table th.tabular-nums')).toBeNull();
      expect(text()).not.toContain('DecimalError');
      await new Promise((r) => setTimeout(r, 100));
      expect(rejections).toEqual([]);
    } finally {
      window.removeEventListener('unhandledrejection', onRejection);
    }
  });

  test('100 兆円以上の金額は読めるので、推移は表示する', async () => {
    await seedEntry({
      id: 'big-2025',
      date: '2025-05-01',
      description: '前年の巨額経費',
      debit: '5150',
      credit: '1130',
      debitAmount: '100000000000000',
    });
    mountReports();
    await runTrend();
    await waitFor(() => container!.querySelector('table th.tabular-nums') !== null);
    expect(text()).not.toContain(m.common_stored_amount_error());
    expect(text()).not.toContain('DecimalError');
  });
});

describe('レポート：申告済みにする前の確認', () => {
  async function openLockDialog(): Promise<void> {
    await waitFor(() => buttonByText(m.reports_lock_button(), container!) !== undefined);
    buttonByText(m.reports_lock_button(), container!)!.click();
    await waitFor(() => buttonByText(m.reports_lock_confirm_action()) !== undefined);
  }

  test('ダイアログを開いた後に明細が読めなくなったら、位置を示して書き込まない', async () => {
    mountReports();
    await openLockDialog();
    await db.journalLines.update('ok-2026-debit', { amount: 'abc' });
    await waitFor(() => text().includes(m.reports_stored_unreadable()));
    buttonByText(m.reports_lock_confirm_action())!.click();
    await waitFor(() => text().includes('正常な売上') && !text().includes(LOAD_ERROR_HEAD));
    await new Promise((r) => setTimeout(r, 200));
    expect(text()).not.toContain('DecimalError');
    expect(await db.reportSnapshots.count()).toBe(0);
    expect(text().split('正常な売上').length - 1).toBeGreaterThanOrEqual(2);
  });

  test('100 兆円以上の明細があるときは位置を示して書き込まない', async () => {
    await seedEntry({
      id: 'big-2026',
      date: '2026-04-01',
      description: '当年の巨額経費',
      debit: '5150',
      credit: '1130',
      debitAmount: '100000000000000',
    });
    mountReports();
    await openLockDialog();
    buttonByText(m.reports_lock_confirm_action())!.click();
    await waitFor(() => text().split('当年の巨額経費').length - 1 >= 2);
    expect(await db.reportSnapshots.count()).toBe(0);
    expect(buttonByText(m.reports_unlock_button(), container!)).toBeUndefined();
  });

  test('正常なら従来どおり申告済みになる', async () => {
    mountReports();
    await openLockDialog();
    buttonByText(m.reports_lock_confirm_action())!.click();
    await waitFor(() => buttonByText(m.reports_unlock_button(), container!) !== undefined);
    expect(await db.reportSnapshots.count()).toBeGreaterThan(0);
  });
});

describe('レポート：金額欄は読めない値と 100 兆円以上で保存を止め、欄を指す', () => {
  const BAD: Array<[string, () => string]> = [
    ['1e3', () => m.common_amount_invalid()],
    ['100000000000000', () => m.common_amount_too_large()],
  ];

  test.each(BAD)('予算に %j を入れると保存せず、その欄に誤りを示す', async (bad, message) => {
    mountReports();
    await waitFor(() => field('budget-revenue-1') !== null);
    const before = await snapshotStores();
    typeInto(field('budget-revenue-1'), bad);
    expect(field('budget-revenue-1').closest('td')!.textContent).toContain(message());
    buttonByText(m.reports_budget_save(), container!)!.click();
    await new Promise((r) => setTimeout(r, 100));
    expect(await snapshotStores()).toBe(before);
  });

  test.each(BAD)('売掛・買掛の追加に %j を入れると追加できず、誤りを示す', async (bad, message) => {
    mountReports();
    await waitFor(() => field('arapAmount') !== null);
    typeInto(field('arapAmount'), bad);
    expect(field('arapAmount').closest('label')!.textContent).toContain(message());
    const form = field('arapAmount').closest('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 100));
    expect(await db.arApEntries.count()).toBe(0);
  });

  test.each(BAD)('中間納付額に %j を入れると、その欄に誤りを示す', async (bad, message) => {
    await setSetting('taxRegistration', 'taxable');
    mountReports();
    await waitFor(() => field('interimPaidNational') !== null);
    typeInto(field('interimPaidNational'), bad);
    expect(field('interimPaidNational').closest('label')!.textContent).toContain(message());
    expect(field('interimPaidLocal').closest('label')!.textContent).not.toContain(message());
  });

  test.each(BAD)(
    '2 割特例の基礎調整に %j を入れると、その欄に誤りを示し、設定は変わらない',
    async (bad, message) => {
      await setSetting('wariBaseAdjustments', { 2026: { salesReturnTax78: '1000' } });
      mountReports();
      await waitFor(() => field('wariSalesReturnTax78') !== null);
      await waitFor(() => field('wariSalesReturnTax78').value === '1000');
      const before = JSON.stringify(await getSetting('wariBaseAdjustments'));
      typeInto(field('wariSalesReturnTax78'), bad, true);
      expect(field('wariSalesReturnTax78').closest('label')!.textContent).toContain(message());
      expect(field('wariSalesReturnTax624').closest('label')!.textContent).not.toContain(message());
      await new Promise((r) => setTimeout(r, 100));
      expect(JSON.stringify(await getSetting('wariBaseAdjustments'))).toBe(before);
    },
  );

  test('入金の記録：保存済みの当初金額が 100 兆円以上なら止め、入金額を変えない', async () => {
    await db.arApEntries.add({
      id: 'big-ar',
      type: 'receivable',
      description: '巨額の売掛',
      dueDate: '2026-12-01',
      originalAmount: '100000000000000',
      paidAmount: '0',
      createdAt: 0,
    });
    mountReports();
    await waitFor(() => field('arap-payment-big-ar') !== null);
    typeInto(field('arap-payment-big-ar'), '100');
    field('arap-payment-big-ar').parentElement!.querySelector('button')!.click();
    await waitFor(() =>
      text().includes(m.error_arap_amount_too_large({ description: '巨額の売掛' })),
    );
    expect((await db.arApEntries.get('big-ar'))?.paidAmount).toBe('0');
  });

  test('入金の記録：保存済みの入金額が読めないなら止め、入金額を変えない', async () => {
    await db.arApEntries.add({
      id: 'bad-ar',
      type: 'receivable',
      description: '壊れた売掛',
      dueDate: '2026-12-01',
      originalAmount: '50000',
      paidAmount: 'abc',
      createdAt: 0,
    });
    mountReports();
    await waitFor(() => text().includes('壊れた売掛'));
    expect(field('arap-payment-bad-ar')).toBeNull();
    expect(text()).toContain(m.common_stored_amount_unreadable());
    expect((await db.arApEntries.get('bad-ar'))?.paidAmount).toBe('abc');
  });
});

describe('レポート：IndexedDB の rejection や別のエラーは従来の扱い', () => {
  test('DecimalError ではないエラーは読み込み失敗として原文のまま示す', async () => {
    const spy = vi.spyOn(db.budgets, 'where').mockImplementation((() => {
      throw new Error('別の障害');
    }) as never);
    try {
      mountReports();
      await waitFor(() => text().includes('別の障害'));
      expect(text()).toContain(LOAD_ERROR_HEAD);
      expect(text()).not.toContain(m.reports_stored_unreadable());
    } finally {
      spy.mockRestore();
    }
  });
});

void newId;

describe('レポート：年の欄が範囲外のあいだ', () => {
  test('ロック・予算の保存・.xtx の出力ボタンを押せない', async () => {
    await setSetting('userRiyoshaId', '1234567890123456');
    await setSetting('userFilerName', '青色 太郎');
    await setSetting('userFilerZip', '1000001');
    await setSetting('userFilerAddress', '東京都千代田区1-1');
    await setSetting('userZeimushoCode', '01101');
    await setSetting('userZeimushoName', 'テスト税務署');
    mountReports();
    await waitFor(() => buttonByText(m.reports_xtx_download(), container!) !== undefined);
    expect(buttonByText(m.reports_lock_button(), container!)?.disabled).toBe(false);
    typeInto(field('reportNen'), '1999');
    expect(text()).toContain(m.common_integer_invalid({ min: 2020, max: 2099 }));
    expect(buttonByText(m.reports_lock_button(), container!)?.disabled).toBe(true);
    expect(buttonByText(m.reports_xtx_download(), container!)?.disabled).toBe(true);
    const budgetSave = buttonByText(m.reports_budget_save(), container!)!;
    budgetSave.click();
    await new Promise((r) => setTimeout(r, 100));
    expect(await db.budgets.count()).toBe(0);
  });
});

describe('レポート：期末棚卸高の試算', () => {
  test('商品と数量を記録した仕訳がある年度では損益計算書の下に試算が出る', async () => {
    await db.inventoryItems.add({ id: 'item-a', name: '試験品A' } as never);
    await seedEntry({
      id: 'purchase',
      date: '2026-03-10',
      description: '商品の仕入',
      debit: '5020',
      credit: '1130',
      debitAmount: '40000',
      debitExtras: { itemId: 'item-a', quantity: '20' },
    });
    mountReports();
    await waitFor(() => text().includes(m.reports_pl_inventory_suggestion_title()));
    expect(text()).toContain('試算額：¥40,000');
  });
});

describe('レポート：年の欄の切替と、範囲外のあいだに押せないボタン', () => {
  test('年の欄を変えると、その年のレポートに切り替わる', async () => {
    await seedEntry({
      id: 'ok-2025',
      date: '2025-06-01',
      description: '前年の売上',
      debit: '1130',
      credit: '4110',
      debitAmount: '7000',
    });
    mountReports();
    await waitFor(() => text().includes(m.reports_overview_title({ year: 2026 })));
    expect(text()).toContain('¥5,000');
    expect(field('reportNen').type).toBe('number');
    typeInto(field('reportNen'), '2025');
    await waitFor(() => text().includes(m.reports_overview_title({ year: 2025 })));
    await waitFor(() => text().includes('¥7,000'));
    expect(text()).not.toContain(m.reports_overview_title({ year: 2026 }));
  });

  test('範囲外のあいだは、ロック解除・消費税の .xtx（中間申告用を含む）・所得税の .xtx も押せず、戻すと押せる', async () => {
    await setSetting('taxRegistration', 'taxable');
    await db.reportSnapshots.bulkAdd([
      {
        id: 'pl-2026',
        year: 2026,
        type: 'pl',
        status: 'filed',
        filedAt: 1,
        payload: {
          type: 'pl',
          data: { rows: [], totalRevenue: '0', totalExpense: '0', netIncome: '0' },
        },
        generatedAt: 1,
        generatedFromEntriesUpTo: '2026-12-31',
      },
      {
        id: 'ct-2025',
        year: 2025,
        type: 'consumption-tax',
        status: 'filed',
        filedAt: 1,
        payload: { type: 'consumption-tax', data: { method: 'general', netTaxNational: '600000' } },
        generatedAt: 1,
        generatedFromEntriesUpTo: '2025-12-31',
      },
    ]);
    mountReports();
    await waitFor(() => buttonByText(m.reports_unlock_button(), container!) !== undefined);
    await waitFor(() => container!.querySelector('[name="interimInstallment"]') !== null);
    const labels = [
      m.reports_consumption_tax_xtx_two_wari_download(),
      m.reports_consumption_tax_xtx_simplified_download(),
      m.reports_consumption_tax_xtx_general_download(),
      m.reports_xtx_download(),
    ];
    const buttons = (label: string) =>
      Array.from(container!.querySelectorAll('button')).filter(
        (b) => b.textContent?.trim() === label,
      );
    // 簡易課税・本則課税の .xtx は消費税の欄と中間申告の欄の 2 か所にある
    expect(labels.map((l) => buttons(l).length)).toEqual([1, 2, 2, 1]);
    const all = () => [
      buttonByText(m.reports_unlock_button(), container!)!,
      ...labels.flatMap((l) => buttons(l)),
    ];
    expect(all().map((b) => b.disabled)).toEqual(all().map(() => false));
    typeInto(field('reportNen'), '1999');
    expect(text()).toContain(m.common_integer_invalid({ min: 2020, max: 2099 }));
    expect(all().map((b) => b.disabled)).toEqual(all().map(() => true));
    typeInto(field('reportNen'), '2026');
    await waitFor(() => all().every((b) => !b.disabled));
  });

  test('範囲外のあいだに「予算を保存」を押しても、予算は保存されない', async () => {
    mountReports();
    await waitFor(() => field('budget-revenue-3') !== null);
    typeInto(field('budget-revenue-3'), '5000');
    typeInto(field('reportNen'), '1999');
    buttonByText(m.reports_budget_save(), container!)!.click();
    await new Promise((r) => setTimeout(r, 150));
    expect(await db.budgets.count()).toBe(0);
  });
});

describe('レポート：予算管理の実績と差異', () => {
  test('同じ行に月別集計の実績と差異（実績 − 予算）が並ぶ', async () => {
    await db.budgets.put({ year: 2026, month: 3, revenueBudget: '3000', expenseBudget: '0' });
    mountReports();
    await waitFor(() => field('budget-revenue-3') !== null);
    await waitFor(() => field('budget-revenue-3').value === '3000');
    const cells = Array.from(field('budget-revenue-3').closest('tr')!.querySelectorAll('td')).map(
      (td) => td.textContent?.trim() ?? '',
    );
    expect(cells[2]).toBe('¥5,000');
    expect(cells[3]).toBe('¥2,000');
  });

  test('保存済みの予算を読めない月は、差異の欄に「金額を読めません」を出し、実績は出す', async () => {
    await db.budgets.put({ year: 2026, month: 3, revenueBudget: 'abc', expenseBudget: '0' });
    mountReports();
    await waitFor(() => field('budget-revenue-3') !== null);
    await waitFor(() =>
      (field('budget-revenue-3').closest('tr')!.textContent ?? '').includes(
        m.common_stored_amount_unreadable(),
      ),
    );
    const cells = Array.from(field('budget-revenue-3').closest('tr')!.querySelectorAll('td')).map(
      (td) => td.textContent?.trim() ?? '',
    );
    expect(cells[2]).toBe('¥5,000');
    expect(cells[3]).toBe(m.common_stored_amount_unreadable());
  });
});

describe('レポート：売掛・買掛と資金繰り予測の表示', () => {
  test.each([
    ['1e3', () => m.common_amount_invalid()],
    ['100000000000000', () => m.common_amount_too_large()],
  ])(
    '入金・支払の欄に %j を入れると、欄の下に誤りを示し、記録ボタンを押しても記録されない',
    async (bad, message) => {
      await db.arApEntries.add({
        id: 'ar-pay',
        type: 'receivable',
        description: '入金の試験',
        dueDate: '2026-12-01',
        originalAmount: '50000',
        paidAmount: '0',
        createdAt: 0,
      });
      mountReports();
      await waitFor(() => field('arap-payment-ar-pay') !== null);
      typeInto(field('arap-payment-ar-pay'), bad);
      expect(field('arap-payment-ar-pay').closest('td')!.textContent).toContain(message());
      field('arap-payment-ar-pay').parentElement!.querySelector('button')!.click();
      await new Promise((r) => setTimeout(r, 100));
      expect((await db.arApEntries.get('ar-pay'))?.paidAmount).toBe('0');
      expect(field('arap-payment-ar-pay').closest('td')!.textContent).toContain(message());
    },
  );

  test.each(['1e3', '100000000000000'])(
    '追加の金額に %j を入れると、「追加」を押せない',
    async (bad) => {
      mountReports();
      await waitFor(() => field('arapAmount') !== null);
      const add = buttonByText(m.reports_arap_add(), field('arapAmount').closest('form')!)!;
      expect(add.disabled).toBe(false);
      typeInto(field('arapAmount'), bad);
      expect(add.disabled).toBe(true);
    },
  );

  test('金額・期日・種別を読めない行は予測に含めず、件数を表示する', async () => {
    for (const [id, over] of [
      ['u-amount', { originalAmount: 'abc' }],
      ['u-date', { dueDate: 20260801 as unknown as string }],
      ['u-type', { type: 'zzz' as never }],
    ] as const) {
      await db.arApEntries.add({
        id,
        type: 'receivable',
        description: id,
        dueDate: '2026-08-01',
        originalAmount: '1000',
        paidAmount: '0',
        createdAt: 0,
        ...over,
      });
    }
    mountReports();
    await waitFor(() => field('cashFlowAsOfDate') !== null);
    typeInto(field('cashFlowAsOfDate'), '2026-07-01');
    buttonByText(m.reports_cashflow_run(), container!)!.click();
    await waitFor(() => text().includes(m.reports_cashflow_unreadable({ count: 3 })));
  });
});

describe('レポート：中間申告の判定と数量を読めない仕訳の表示', () => {
  test.each(['abc', '0', '13', '1.5'])(
    '直前の課税期間の月数に %j を入れると、判定を出さず案内を出す',
    async (bad) => {
      mountReports();
      await waitFor(() => field('interimPriorNenAmount') !== null);
      typeInto(field('interimPriorNenAmount'), '150000');
      await waitFor(() => text().includes('中間申告義務'));
      typeInto(field('interimPriorPeriodMonths'), bad);
      expect(text()).toContain(m.reports_interim_inputs_invalid());
      expect(text()).not.toContain('中間申告義務はありません');
      expect(text()).not.toContain('中間申告義務があります');
    },
  );

  test('数量を読めない仕訳と数量が負の仕訳は試算に数えず、日付と摘要を一覧に出す', async () => {
    await db.inventoryItems.add({ id: 'item-a', name: '試験品A' } as never);
    await seedEntry({
      id: 'purchase-ok',
      date: '2026-03-10',
      description: '正常な仕入',
      debit: '5020',
      credit: '1130',
      debitAmount: '40000',
      debitExtras: { itemId: 'item-a', quantity: '20' },
    });
    await seedEntry({
      id: 'purchase-abc',
      date: '2026-03-11',
      description: '数量が壊れた仕入',
      debit: '5020',
      credit: '1130',
      debitAmount: '1000',
      debitExtras: { itemId: 'item-a', quantity: 'abc' },
    });
    await seedEntry({
      id: 'purchase-neg',
      date: '2026-03-12',
      description: '数量が負の仕入',
      debit: '5020',
      credit: '1130',
      debitAmount: '1000',
      debitExtras: { itemId: 'item-a', quantity: '-3' },
    });
    mountReports();
    await waitFor(() => text().includes(m.reports_inventory_quantity_unreadable()));
    expect(text()).toContain('2026-03-11 数量が壊れた仕入');
    expect(text()).toContain('2026-03-12 数量が負の仕入');
    expect(text()).not.toContain('2026-03-10 正常な仕入');
    expect(text()).toContain('試算額：¥40,000');
  });
});

describe('レポート：集計が失敗したときは数字を消す', () => {
  test('当年の明細が読めないと、月別売上・損益計算書の数字が消え、通知と一覧だけが出る', async () => {
    await seedEntry({
      id: 'bad-2026',
      date: '2026-04-01',
      description: '当年の壊れた経費',
      debit: '5150',
      credit: '1130',
      debitAmount: 'abc',
      creditAmount: '1000',
    });
    mountReports();
    await waitFor(() => text().includes('当年の壊れた経費'));
    expect(text()).toContain(m.reports_stored_unreadable());
    expect(text()).not.toContain('¥5,000');
    expect(text()).not.toContain(m.reports_overview_title({ year: 2026 }));
  });
});
