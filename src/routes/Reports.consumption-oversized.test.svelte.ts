import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { setSetting } from '../lib/settings';
import { toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { m } from '../paraglide/messages';
import type { Account, PersonalDeductionInput } from '../db/types';

const { saveTextFile } = vi.hoisted(() => ({
  saveTextFile: vi.fn(async (..._args: unknown[]) => 'saved' as const),
}));
vi.mock('../lib/save-file', () => ({ saveTextFile }));

const { default: Reports } = await import('./Reports.svelte');

const TOO_LARGE = (items: string) =>
  `保存されている次の金額が 100 兆円以上のため、出力できません。設定や入力画面で直してください：${items}`;
const UNREADABLE = (items: string) =>
  `保存されている次の値を読めないため、出力できません。設定や入力画面で直してください：${items}`;

const SETTINGS = [
  {
    id: 'base',
    label: '基準期間（前々年）の課税売上高（円）',
    store: (v: string) => setSetting('basePeriodTaxableSales', v),
  },
  {
    id: 'specified',
    label: '特定期間（前年1月〜6月）の課税売上高（円）',
    store: (v: string) => setSetting('specifiedPeriodTaxableSales', v),
  },
  {
    id: 'return78',
    label: '売上対価の返還等に係る消費税額（税率7.8%分）',
    store: (v: string) => setSetting('wariBaseAdjustments', { 2026: { salesReturnTax78: v } }),
  },
  {
    id: 'return624',
    label: '売上対価の返還等に係る消費税額（税率6.24%分）',
    store: (v: string) => setSetting('wariBaseAdjustments', { 2026: { salesReturnTax624: v } }),
  },
  {
    id: 'transfer',
    label: '特定少額資産の譲渡（3 割特例の基礎から控除）',
    store: (v: string) =>
      setSetting('wariBaseAdjustments', {
        2026: { specifiedSmallAssetTransfers: [{ date: '2026-03-01', rate: 0.1, netTax: v }] },
      }),
  },
] as const;

const ENTRIES = [
  { id: 'two-wari', label: m.reports_consumption_tax_xtx_two_wari_download() },
  { id: 'simplified', label: m.reports_consumption_tax_xtx_simplified_download() },
  { id: 'general', label: m.reports_consumption_tax_xtx_general_download() },
] as const;

const BIG = '100000000000000';
const JUST_BELOW = '99999999999999';

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function seedSale(): Promise<void> {
  const entryId = newId();
  await db.journalEntries.add({
    id: entryId,
    date: '2026-06-15',
    year: 2026,
    description: '売上',
    status: 'confirmed',
    source: 'manual',
    createdAt: 1,
    confirmedAt: 1,
  });
  await db.journalLines.bulkAdd(
    (['debit', 'credit'] as const).map((side) => ({
      id: newId(),
      entryId,
      side,
      accountCode: side === 'debit' ? '1130' : '4110',
      amount: '1100000',
      amountIndexed: toIndexable('1100000'),
      taxRate: side === 'credit' ? 0.1 : 0,
      taxIncluded: true,
      invoiceCompliant: false,
    })),
  );
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
  await waitFor(
    () =>
      buttonByText(m.reports_xtx_download()) !== undefined &&
      buttonByText(m.reports_consumption_tax_xtx_general_download()) !== undefined,
  );
}

async function mountWithButton(label: string): Promise<void> {
  await mountReports();
  await waitFor(() => buttonByText(label) !== undefined);
}

async function press(label: string): Promise<void> {
  buttonByText(label)!.click();
  await sleep(150);
  const start = Date.now();
  while (
    saveTextFile.mock.calls.length === 0 &&
    container!.querySelector('p.border-destructive') === null &&
    Date.now() - start < 3000
  ) {
    await sleep(20);
  }
  await sleep(100);
}

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
  await seedSale();
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

describe.each(SETTINGS)('消費税の設定「$label」', (setting) => {
  describe.each(ENTRIES)('$id の .xtx', (entry) => {
    const baseOnTwoWari = setting.id === 'base' && entry.id === 'two-wari';

    if (baseOnTwoWari) {
      test('100 兆円以上だと年度が対象外になり、2 割特例の出力ボタンが出ず、ファイルも出ない', async () => {
        await setting.store(BIG);
        await mountReports();
        await sleep(300);
        expect(buttonByText(entry.label)).toBeUndefined();
        expect(saveTextFile).not.toHaveBeenCalled();
      });
      test('99,999,999,999,999 円でも年度が対象外になり、2 割特例の出力ボタンが出ない', async () => {
        await setting.store(JUST_BELOW);
        await mountReports();
        await sleep(300);
        expect(buttonByText(entry.label)).toBeUndefined();
        expect(saveTextFile).not.toHaveBeenCalled();
      });
    } else {
      test('100 兆円以上だと出力を止め、新しい文言で設定名を示し、ファイルを出さない', async () => {
        await setting.store(BIG);
        await mountWithButton(entry.label);
        await press(entry.label);
        expect(text()).toContain(TOO_LARGE(setting.label));
        expect(saveTextFile).not.toHaveBeenCalled();
      });
      test('99,999,999,999,999 円なら止めずにファイルを出す', async () => {
        await setting.store(JUST_BELOW);
        await mountWithButton(entry.label);
        await press(entry.label);
        expect(saveTextFile).toHaveBeenCalledTimes(1);
        expect(container!.querySelector('p.border-destructive')).toBeNull();
      });
    }

    test.each(['-100000000000000', 'abc'])(
      '読めない値 %j は従来の文言で止め、100 兆円以上の文言は出さない',
      async (bad) => {
        await setting.store(bad);
        await mountWithButton(entry.label);
        await press(entry.label);
        expect(text()).toContain(UNREADABLE(setting.label));
        expect(text()).not.toContain('100 兆円以上のため');
        expect(saveTextFile).not.toHaveBeenCalled();
      },
    );
  });
});

describe.each(SETTINGS.filter((s) => s.id !== 'base'))(
  '読めない基準期間の課税売上高と、100 兆円以上の「$label」が同時にあるとき',
  (setting) => {
    test.each(ENTRIES)('$id の .xtx は両方の文言を示し、ファイルを出さない', async (entry) => {
      await SETTINGS[0].store('abc');
      await setting.store(BIG);
      await mountWithButton(entry.label);
      await press(entry.label);
      const unreadable = UNREADABLE(SETTINGS[0].label);
      const tooLarge = TOO_LARGE(setting.label);
      expect(text()).toContain(unreadable);
      expect(text()).toContain(tooLarge);
      expect(text().indexOf(unreadable)).toBeLessThan(text().indexOf(tooLarge));
      expect(saveTextFile).not.toHaveBeenCalled();
    });
  },
);

describe('所得税の .xtx', () => {
  test('消費税の設定が 100 兆円以上でも止まらず、15 桁の公的年金等もそのまま出力する', async () => {
    for (const setting of SETTINGS) {
      await setting.store(BIG);
    }
    await setSetting('wariBaseAdjustments', {
      2026: {
        salesReturnTax78: BIG,
        salesReturnTax624: BIG,
        specifiedSmallAssetTransfers: [{ date: '2026-03-01', rate: 0.1, netTax: BIG }],
      },
    });
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
      miscIncome: {
        publicPensionAmount: '123456789012345',
        otherIncome: '0',
        otherExpenses: '0',
      },
      updatedAt: 1,
    } as PersonalDeductionInput);
    await mountReports();
    await press(m.reports_xtx_download());
    expect(saveTextFile).toHaveBeenCalledTimes(1);
    expect(String(saveTextFile.mock.calls[0]?.[0])).toContain(
      '<ABB01060>123456789012345</ABB01060>',
    );
    expect(text()).not.toContain('100 兆円以上のため');
  });
});
