import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { setSetting } from '../lib/settings';
import { toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { reverseEntry } from '../domain/reverse';
import { m } from '../paraglide/messages';
import type { Account, FixedAsset, JournalLine, PersonalDeductionInput } from '../db/types';

const { saveTextFile } = vi.hoisted(() => ({
  saveTextFile: vi.fn(async () => 'saved' as const),
}));
vi.mock('../lib/save-file', () => ({ saveTextFile }));

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

async function seedEntry(opts: {
  description: string;
  amount: string;
  debit: string;
  credit: string;
  debitExtras?: Partial<JournalLine>;
}): Promise<string> {
  const entryId = newId();
  await db.journalEntries.add({
    id: entryId,
    date: '2026-06-15',
    year: 2026,
    description: opts.description,
    status: 'confirmed',
    source: 'manual',
    createdAt: 1,
    confirmedAt: 1,
  });
  const indexed =
    /^\d+(\.\d+)?$/.test(opts.amount) && opts.amount.length <= 14
      ? toIndexable(opts.amount)
      : '00000000000000.00';
  await db.journalLines.bulkAdd(
    (['debit', 'credit'] as const).map((side) => ({
      id: newId(),
      entryId,
      side,
      accountCode: side === 'debit' ? opts.debit : opts.credit,
      amount: opts.amount,
      amountIndexed: indexed,
      taxRate: side === 'credit' ? 0.1 : 0,
      taxIncluded: true,
      invoiceCompliant: false,
      ...(side === 'debit' ? (opts.debitExtras ?? {}) : {}),
    })),
  );
  return entryId;
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function text(): string {
  return container?.textContent ?? '';
}

function buttonByText(label: string): HTMLButtonElement | undefined {
  return Array.from(container!.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label,
  );
}

async function mountReports(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Reports, { target: container, props: {} });
  await waitFor(() => buttonByText(m.reports_xtx_download()) !== undefined);
}

const XTX_BUTTONS = [
  m.reports_xtx_download(),
  m.reports_consumption_tax_xtx_simplified_download(),
  m.reports_consumption_tax_xtx_general_download(),
  m.reports_consumption_tax_xtx_two_wari_download(),
];

const CONSUMPTION_BUTTONS = XTX_BUTTONS.slice(1);

beforeEach(async () => {
  await db.delete();
  await db.open();
  const accs: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year: 2026 }));
  await db.accounts.bulkPut(accs);
  await setSetting('currentYear', 2026);
  await setSetting('taxRegistration', 'taxable');
  await setSetting('simplifiedTaxCategory', 4);
  await setSetting('userRiyoshaId', '1234567890123456');
  await setSetting('userFilerName', '青色 太郎');
  await setSetting('userFilerZip', '1000001');
  await setSetting('userFilerAddress', '東京都千代田区1-1');
  await setSetting('userZeimushoCode', '01101');
  await setSetting('userZeimushoName', 'テスト税務署');
  await seedEntry({ description: '売上', amount: '1100000', debit: '1130', credit: '4110' });
  saveTextFile.mockClear();
});

afterEach(async () => {
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  container?.remove();
  container = undefined;
  await db.delete();
});

describe('1e15 の明細があるとき', () => {
  test.each(XTX_BUTTONS)('「%s」は止まって明細を示し、ファイルを出さない', async (label) => {
    await seedEntry({
      description: '桁あふれ取引',
      amount: '1000000000000000',
      debit: '5150',
      credit: '1130',
    });
    await mountReports();
    await waitFor(() => container!.querySelector('[role="alert"]') !== null);
    expect(text()).toContain('桁あふれ取引');
    buttonByText(label)!.click();
    // 常設の案内に加え、押したボタンの欄にも同じ一覧が出る
    await waitFor(() => text().split('桁あふれ取引').length - 1 >= 4);
    expect(saveTextFile).not.toHaveBeenCalled();
  });

  test('訂正仕訳で打ち消すと案内が消え、.xtx を出せる', async () => {
    const id = await seedEntry({
      description: '桁あふれ取引',
      amount: '1000000000000000',
      debit: '5150',
      credit: '1130',
    });
    await reverseEntry(id);
    await mountReports();
    expect(text()).not.toContain('桁あふれ取引');
    buttonByText(m.reports_xtx_download())!.click();
    await waitFor(() => saveTextFile.mock.calls.length > 0);
  });
});

describe('保存済みの値を読めないとき', () => {
  function asset(overrides: Partial<FixedAsset>): FixedAsset {
    return {
      id: newId(),
      name: '壊れた資産',
      acquisitionDate: '2026-01-01',
      acquisitionCost: '300000',
      usefulLifeYears: 4,
      depreciationMethod: 'straight-line',
      accountCode: '1510',
      ...overrides,
    };
  }

  test.each([
    { usefulLifeYears: 'abc' as unknown as number },
    { depreciationMethod: 'lease-period-straight-line' as const },
    { acquisitionCost: 'abc' },
  ])('固定資産 %j は .xtx を出さず資産名と理由を示す', async (overrides) => {
    await db.fixedAssets.add(asset(overrides));
    await mountReports();
    buttonByText(m.reports_xtx_download())!.click();
    await waitFor(() =>
      text().includes(m.fixed_asset_invalid({ name: '壊れた資産', reasons: '' })),
    );
    expect(saveTextFile).not.toHaveBeenCalled();
  });

  test.each([
    [{ socialInsurancePaid: '-5000' }, m.income_deductions_social_insurance_paid()],
    [
      { realEstateIncome: { businessScale: false, rentPaid: [{ amount: 'abc' }] } },
      m.income_deductions_real_estate_rent_paid_title(),
    ],
    [{ socialInsurancePaid: '2e+20' }, m.income_deductions_social_insurance_paid()],
  ])('所得控除 %j は .xtx を出さず欄の名前を示す', async (overrides, label) => {
    await db.personalDeductions.put({
      year: 2026,
      socialInsurancePaid: '0',
      smallBusinessMutualAidPaid: '0',
      lifeInsurance: {},
      earthquakeInsurancePaid: '0',
      oldLongTermInsurancePaid: '0',
      medicalExpensePaid: '0',
      medicalInsuranceReimbursement: '0',
      donationAmount: '0',
      casualtyLossDeduction: '0',
      isDisabled: false,
      isSpecialDisabled: false,
      isSingleParent: false,
      isWidow: false,
      isWorkingStudent: false,
      dependents: [],
      updatedAt: 1,
      ...overrides,
    } as PersonalDeductionInput);
    await mountReports();
    buttonByText(m.reports_xtx_download())!.click();
    await waitFor(() => text().includes(label));
    expect(saveTextFile).not.toHaveBeenCalled();
  });

  test.each(CONSUMPTION_BUTTONS)(
    '数値で保存された基準期間の課税売上高では「%s」は止まり設定名を示す',
    async (label) => {
      await setSetting('basePeriodTaxableSales', 20000000 as unknown as string);
      await mountReports();
      buttonByText(label)!.click();
      await waitFor(() => text().includes(m.settings_ct_base_period_sales()));
      expect(saveTextFile).not.toHaveBeenCalled();
    },
  );

  test('売掛金・予算・在庫数量の読めない行だけを示し、他の数字は表示する', async () => {
    for (const [id, originalAmount] of [
      ['a', '1e3'],
      ['b', '1e-7'],
      ['c', 'abc'],
    ] as const) {
      await db.arApEntries.add({
        id,
        type: 'receivable',
        description: `売掛${id}`,
        dueDate: '2026-08-01',
        originalAmount,
        paidAmount: '0',
        createdAt: 1,
      });
    }
    await db.budgets.put({ year: 2026, month: 1, revenueBudget: 'abc', expenseBudget: '0' });
    await seedEntry({
      description: '数量の壊れた仕入',
      amount: '5000',
      debit: '5020',
      credit: '1130',
      debitExtras: { itemId: 'item1', quantity: 'abc' },
    });
    await mountReports();
    await waitFor(() => text().includes('売掛c'));
    const unreadable = text().split(m.common_stored_amount_unreadable()).length - 1;
    // 売掛金 1 行・予算 1 か月分
    expect(unreadable).toBe(2);
    expect(text()).toContain('¥1,000');
    expect(text()).toContain(m.reports_inventory_quantity_unreadable());
    expect(text()).toContain('数量の壊れた仕入');
    expect(text()).toContain('¥1,100,000');
  });
});

describe('申告時スナップショットを読めないとき', () => {
  async function putSnapshot(type: 'pl' | 'bs', payload: unknown): Promise<void> {
    await db.reportSnapshots.add({
      id: newId(),
      year: 2026,
      type,
      status: 'superseded',
      filedAt: 1,
      payload: payload as never,
      generatedAt: 1,
      generatedFromEntriesUpTo: '2026-12-31',
    });
  }
  const pl = { rows: [], totalRevenue: '1000000', totalExpense: '0', netIncome: '1000000' };

  test.each([
    ['PL の totalRevenue が abc', { type: 'pl', data: { ...pl, totalRevenue: 'abc' } }, null],
    ['PL の payload が null', null, null],
    ['BS の payload が null', { type: 'pl', data: pl }, null],
    ['BS の data が空', { type: 'pl', data: pl }, { type: 'bs', data: {} }],
  ])(
    '%s：修正申告欄は「金額を読めません」、報表の数字は表示する',
    async (label, plPayload, bsPayload) => {
      await putSnapshot('pl', plPayload);
      if (label.startsWith('BS')) {
        await putSnapshot('bs', bsPayload);
      }
      await mountReports();
      await waitFor(() => text().includes(m.reports_amendment_title()));
      expect(text()).toContain(m.common_stored_amount_unreadable());
      expect(text()).not.toContain(m.reports_amendment_no_change());
      expect(text()).toContain('¥1,100,000');
    },
  );
});
