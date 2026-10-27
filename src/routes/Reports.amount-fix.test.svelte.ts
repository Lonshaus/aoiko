import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { deleteSetting, setSetting } from '../lib/settings';
import { toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { m } from '../paraglide/messages';
import type { Account, FixedAsset } from '../db/types';

const { saveTextFile } = vi.hoisted(() => ({
  saveTextFile: vi.fn(async (..._args: unknown[]) => 'saved' as const),
}));
vi.mock('../lib/save-file', () => ({ saveTextFile }));

const { default: Reports } = await import('./Reports.svelte');

const uncaught: unknown[] = [];
window.addEventListener('error', (e) => uncaught.push(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => uncaught.push(e.reason));

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function seedLine(extra: Record<string, unknown> = {}): Promise<void> {
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
      ...(side === 'credit' ? extra : {}),
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
  await waitFor(() => buttonByText(m.reports_xtx_download()) !== undefined);
}

async function clickXtx(label = m.reports_xtx_download()): Promise<void> {
  saveTextFile.mockClear();
  buttonByText(label)!.click();
  await new Promise((r) => setTimeout(r, 300));
}

function savedXml(): string {
  return String(saveTextFile.mock.calls[0]?.[0] ?? '');
}

beforeEach(async () => {
  uncaught.length = 0;
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
  await setSetting('userZeimushoName', '麹町');
  await seedLine();
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

async function put(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value, updatedAt: Date.now() });
}

describe('復元された申告者情報の型（R1・R2・S8〜S10）', () => {
  test.each([
    ['数値の郵便番号', 'userFilerZip', 1000001],
    ['数値の氏名', 'userFilerName', 123],
    ['数値の屋号', 'userBusinessName', 123],
  ])('%s は文字列として読み、.xtx を出す', async (_label, key, value) => {
    await put(key, value);
    await mountReports();
    await clickXtx();
    expect(saveTextFile).toHaveBeenCalledTimes(1);
    if (key === 'userFilerName') {
      expect(savedXml()).toContain('>123<');
    }
    expect(uncaught).toEqual([]);
  });

  test('郵便番号・屋号・登録番号が未設定でも .xtx を出す', async () => {
    await deleteSetting('userFilerZip');
    await mountReports();
    await clickXtx();
    expect(saveTextFile).toHaveBeenCalledTimes(1);
  });

  test.each([
    m.reports_xtx_download(),
    m.reports_consumption_tax_xtx_simplified_download(),
    m.reports_consumption_tax_xtx_general_download(),
    m.reports_consumption_tax_xtx_two_wari_download(),
  ])('数値の利用者識別番号では「%s」を止めて案内する', async (label) => {
    await put('userRiyoshaId', 1234567890123456);
    await mountReports();
    await waitFor(() => buttonByText(label) !== undefined);
    await clickXtx(label);
    expect(text()).toContain(m.reports_xtx_filer_invalid());
    expect(saveTextFile).not.toHaveBeenCalled();
    expect(uncaught).toEqual([]);
  });

  test.each([
    ['userFilerAddress', {}],
    ['userFilerZip', {}],
    ['userRiyoshaId', {}],
    ['userRiyoshaId', 9007199254740993],
    ['userZeimushoCode', '1101'],
  ])('%s が %j のとき .xtx を止めて案内する', async (key, value) => {
    await put(key, value);
    await mountReports();
    await clickXtx();
    expect(text()).toContain(m.reports_xtx_filer_invalid());
    expect(saveTextFile).not.toHaveBeenCalled();
    expect(uncaught).toEqual([]);
  });
});

describe('年の欄が読めないとき（R11）', () => {
  test('1999 では .xtx と申告済みにするボタンを止め、理由を示す', async () => {
    await mountReports();
    const input = container!.querySelector<HTMLInputElement>('input[name="reportNen"]')!;
    input.value = '1999';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(buttonByText(m.reports_xtx_download())!.disabled).toBe(true);
    expect(buttonByText(m.reports_lock_button())!.disabled).toBe(true);
    expect(buttonByText(m.reports_consumption_tax_xtx_general_download())!.disabled).toBe(true);
    expect(text()).toContain(m.common_integer_invalid({ min: 2020, max: 2099 }));
    buttonByText(m.reports_xtx_download())!.click();
    await new Promise((r) => setTimeout(r, 100));
    expect(saveTextFile).not.toHaveBeenCalled();
  });
});

describe('集計が失敗したとき（R19）', () => {
  test('読めない対価の明細の案内は、集計の失敗と一緒に出し続ける', async () => {
    await seedLine({ taxableTransferConsideration: '1' + '0'.repeat(1500) });
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });
    await waitFor(() =>
      text().includes(
        m.error_consideration_unreadable({ date: '2026-06-15', description: '売上' }),
      ),
    );
    await waitFor(() => container!.querySelector('[role="alert"]') !== null);
    expect(container!.querySelector('[role="alert"]')!.textContent).toContain('2026-06-15');
  });
});

function fixed(overrides: Partial<FixedAsset> & { id: string }): FixedAsset {
  return {
    name: '通常資産',
    acquisitionDate: '2025-01-01',
    acquisitionCost: '400000',
    usefulLifeYears: 4,
    depreciationMethod: 'straight-line',
    accountCode: '1510',
    ...overrides,
  };
}

describe('.xtx の固定資産（R3・R16・R17・R23）', () => {
  test('減価償却明細の行数を超えた資産は、出力したうえで名前を示す', async () => {
    await db.fixedAssets.bulkAdd(
      Array.from({ length: 8 }, (_, i) =>
        fixed({ id: `a${i}`, name: `資産${i + 1}`, acquisitionDate: `2025-01-0${i + 1}` }),
      ),
    );
    await mountReports();
    await clickXtx();
    expect(saveTextFile).toHaveBeenCalledTimes(1);
    expect(text()).toContain('資産8');
  });

  test.each([
    [
      '落選して率表に無い耐用年数になる少額特例',
      [
        ...Array.from({ length: 10 }, (_, i) =>
          fixed({
            id: `c${i}`,
            name: `枠${i}`,
            acquisitionDate: `2026-01-1${i}`,
            acquisitionCost: '290000',
            depreciationMethod: 'small-asset-special',
          }),
        ),
        fixed({
          id: 's',
          name: '問題の資産',
          acquisitionDate: '2026-03-01',
          acquisitionCost: '200000',
          usefulLifeYears: 25,
          depreciationMethod: 'small-asset-special',
          decliningBalanceElected: true,
        }),
      ],
    ],
    [
      '物件の種類の無い貸家',
      [
        fixed({
          id: 'r',
          name: '問題の資産',
          incomeType: 'realEstate',
          realEstateDetail: { propertyType: '', address: '東京', annualRent: '100' },
        }),
      ],
    ],
  ])('%s は .xtx を止めて資産名を示す', async (_label, assets) => {
    await db.fixedAssets.bulkAdd(assets);
    await mountReports();
    await clickXtx();
    expect(saveTextFile).not.toHaveBeenCalled();
    expect(text()).toContain('問題の資産');
    expect(uncaught).toEqual([]);
  });

  test('廃業日が日付として読めないと .xtx を止めて理由を示す', async () => {
    await setSetting('businessCloseDate', '2026/12/31');
    await mountReports();
    await clickXtx();
    expect(saveTextFile).not.toHaveBeenCalled();
    expect(text()).toContain(m.business_date_invalid_setting_close({ value: '2026/12/31' }));
  });
});
