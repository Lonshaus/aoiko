import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { setSetting } from '../lib/settings';
import { formatJPY } from '../lib/decimal';
import { markYearFiled } from '../domain/snapshots';
import { filedYearGuard } from '../lib/filed-year-guard.svelte';
import { m } from '../paraglide/messages';
import type { FixedAsset, ReportSnapshotData } from '../db/types';

const { default: Settings } = await import('./Settings.svelte');

const Y = new Date().getFullYear();
const uncaught: unknown[] = [];
window.addEventListener('error', (e) => uncaught.push(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => uncaught.push(e.reason));

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}
// onMount の読み込みが終わる前に DB を消すと後続のテストが壊れるため、最後に読まれる設定の表示を待つ
const MOUNT_SENTINEL = 'ZZZ9';
let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function text(): string {
  return container?.textContent ?? '';
}

function field<T extends HTMLElement = HTMLInputElement>(name: string): T {
  return container!.querySelector<T>(`[name="${name}"]`) as T;
}

function type(name: string, value: string): void {
  const el = field(name);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function buttonByText(label: string, root: ParentNode = container!): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
}

function rowOf(name: string): HTMLTableRowElement {
  return Array.from(container!.querySelectorAll('tbody tr')).find((tr) =>
    tr.querySelector('td')?.textContent?.includes(name),
  ) as HTMLTableRowElement;
}

function cell(name: string, index: number): string {
  return rowOf(name).querySelectorAll('td')[index]?.textContent?.trim() ?? '';
}

async function mountSettings(): Promise<void> {
  await db.settings.put({
    key: 'homeOfficeAccountRatios',
    value: { [MOUNT_SENTINEL]: '0.30' },
    updatedAt: Date.now(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Settings, { target: container, props: {} });
  await waitFor(() => text().includes(MOUNT_SENTINEL));
}

function asset(overrides: Partial<FixedAsset> & { id: string }): FixedAsset {
  return {
    name: '通常資産',
    acquisitionDate: `${Y}-01-01`,
    acquisitionCost: '400000',
    usefulLifeYears: 4,
    depreciationMethod: 'straight-line',
    accountCode: '1510',
    ...overrides,
  };
}

function capFillers(): FixedAsset[] {
  return Array.from({ length: 10 }, (_, i) =>
    asset({
      id: `cap${i}`,
      name: `枠${i}`,
      acquisitionDate: `${Y}-01-${String(i + 10).padStart(2, '0')}`,
      acquisitionCost: '290000',
      depreciationMethod: 'small-asset-special',
    }),
  );
}

beforeEach(async () => {
  uncaught.length = 0;
  filedYearGuard.pending = null;
  await db.delete();
  await db.open();
  await setSetting('currentYear', Y);
});

afterEach(async () => {
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  container?.remove();
  container = undefined;
  filedYearGuard.pending = null;
  await db.delete();
});

describe('復元された申告者情報（R1）', () => {
  test('数値の郵便番号はその数字を表示し、誤りとしない', async () => {
    await db.settings.put({ key: 'userFilerZip', value: 1000001, updatedAt: 1 });
    await mountSettings();
    expect(field('filerYubinBango').value).toBe('1000001');
    expect(text()).not.toContain(m.settings_filer_zip_invalid());
    expect(uncaught).toEqual([]);
  });

  test('数値の利用者識別番号は画面を壊さずに誤りとして示し、保存を止める', async () => {
    await db.settings.put({ key: 'userRiyoshaId', value: 1234567890123456, updatedAt: 1 });
    await mountSettings();
    expect(text()).toContain(m.settings_filer_riyosha_id_invalid());
    expect(
      buttonByText(m.settings_basic_save(), field('etaxRiyoshaId').closest('form')!)!.disabled,
    ).toBe(true);
    type('etaxRiyoshaId', '1234567890123456');
    expect(text()).not.toContain(m.settings_filer_riyosha_id_invalid());
    expect(uncaught).toEqual([]);
  });

  test('物の氏名・郵便番号は読めない値として示す', async () => {
    await db.settings.put({ key: 'userFilerName', value: {}, updatedAt: 1 });
    await db.settings.put({ key: 'userFilerZip', value: {}, updatedAt: 1 });
    await mountSettings();
    expect(text()).toContain(m.settings_filer_stored_unreadable());
    expect(text()).toContain(m.settings_filer_zip_invalid());
    expect(uncaught).toEqual([]);
  });
});

describe('不動産の明細の編集（R6）', () => {
  test('数値の年額の賃貸料でも編集欄を開け、入力し直すと文字列で保存する', async () => {
    await setSetting('realEstateIncomeEnabled', true);
    await db.fixedAssets.add(
      asset({
        id: 'p1',
        name: '貸家テスト',
        incomeType: 'realEstate',
        realEstateDetail: {
          propertyType: '住宅',
          isResidential: true,
          address: '東京',
          annualRent: 1200000 as never,
        },
      }),
    );
    await mountSettings();
    await waitFor(() => text().includes('貸家テスト'));
    buttonByText(m.settings_asset_property_button())!.click();
    flushSync();
    expect(field('propertyAnnualRent').value).toBe('1200000');
    type('propertyAnnualRent', '1300000');
    const panel = field('propertyAnnualRent').closest('td')!;
    buttonByText(m.settings_action_save(), panel)!.click();
    await waitFor(() => field('propertyAnnualRent') === null);
    expect((await db.fixedAssets.get('p1'))?.realEstateDetail?.annualRent).toBe('1300000');
    expect(uncaught).toEqual([]);
  });
});

describe('耐用年数・リース月数の修正（R4）', () => {
  const lease = () =>
    asset({ id: 'lease', name: 'リース機械', depreciationMethod: 'lease-period-straight-line' });

  test('月数の無いリース資産は「修正」で月数を入れると、減価償却で 2 件書ける', async () => {
    await db.fixedAssets.bulkAdd([lease(), asset({ id: 'n' })]);
    await mountSettings();
    await waitFor(() => text().includes('リース機械'));
    buttonByText(m.settings_asset_fix_button())!.click();
    flushSync();
    type('assetFixLeaseTermMonths', '36');
    buttonByText(
      m.settings_action_save(),
      field('assetFixLeaseTermMonths').closest('td')!,
    )!.click();
    await waitFor(() => field('assetFixLeaseTermMonths') === null);
    expect((await db.fixedAssets.get('lease'))?.leaseTermMonths).toBe(36);
    await waitFor(() => buttonByText(m.settings_asset_fix_button()) === undefined);
    buttonByText(m.settings_asset_run_button())!.click();
    await waitFor(() => text().includes(m.settings_asset_run_success({ created: 2 })));
    expect(await db.journalEntries.count()).toBe(2);
  });

  test('確定した仕訳のある資産は、申告済みの年を含め確認してから直す', async () => {
    await db.fixedAssets.bulkAdd([lease()]);
    await db.journalEntries.add({
      id: 'old',
      date: `${Y}-12-31`,
      year: Y,
      description: '減価償却 リース機械 #lease',
      status: 'confirmed',
      source: 'manual',
      createdAt: 1,
      confirmedAt: 1,
    });
    const pl: ReportSnapshotData & { type: 'pl' } = {
      type: 'pl',
      data: { rows: [], totalRevenue: '0', totalExpense: '0', netIncome: '0' },
    };
    const monthlySales: ReportSnapshotData & { type: 'monthly-sales' } = {
      type: 'monthly-sales',
      data: { months: [] },
    };
    await markYearFiled(Y, { monthlySales, pl }, `${Y}-12-31`);
    await mountSettings();
    await waitFor(() => text().includes('リース機械'));
    buttonByText(m.settings_asset_fix_button())!.click();
    flushSync();
    type('assetFixLeaseTermMonths', '36');
    buttonByText(
      m.settings_action_save(),
      field('assetFixLeaseTermMonths').closest('td')!,
    )!.click();
    await waitFor(() =>
      (document.body.textContent ?? '').includes(m.settings_asset_fix_confirm_title()),
    );
    expect((await db.fixedAssets.get('lease'))?.leaseTermMonths).toBeUndefined();
    buttonByText(m.settings_asset_fix_confirm_action(), document.body)!.click();
    await waitFor(() => filedYearGuard.pending !== null);
    expect(filedYearGuard.pending?.years).toContain(Y);
    await filedYearGuard.resolve(true);
    await waitFor(() => field('assetFixLeaseTermMonths') === null);
    expect((await db.fixedAssets.get('lease'))?.leaseTermMonths).toBe(36);
  });
});

describe('一覧の計算（S4・R3・S3・R23）', () => {
  test('落選して計算できない売却資産はその行に理由を出し、譲渡所得の合計は名前付きで「—」にする', async () => {
    await db.fixedAssets.bulkAdd([
      ...capFillers(),
      asset({
        id: 'bad',
        name: '落選した売却',
        acquisitionDate: `${Y}-03-01`,
        acquisitionCost: '200000',
        usefulLifeYears: 1,
        depreciationMethod: 'small-asset-special',
        decliningBalanceElected: true,
        disposedDate: `${Y}-06-30`,
        disposalType: 'sale',
        salePrice: '100000',
      }),
      asset({
        id: 'ok',
        name: '正常な売却',
        acquisitionDate: `${Y - 2}-01-01`,
        disposedDate: `${Y}-06-30`,
        disposalType: 'sale',
        salePrice: '300000',
      }),
    ]);
    await mountSettings();
    await waitFor(() => text().includes('落選した売却'));
    expect(rowOf('落選した売却').querySelector('[role="alert"]')).not.toBeNull();
    expect(text()).toContain(m.settings_transfer_income_unavailable({ names: '落選した売却' }));
    expect(uncaught).toEqual([]);
  });

  test('売却価格が長い 16 進の資産でも 2 秒以内に表示し、合計は部分合計にしない', async () => {
    await db.fixedAssets.bulkAdd([
      asset({
        id: 'hex',
        name: '16進の売却',
        acquisitionDate: `${Y - 2}-01-01`,
        disposedDate: `${Y}-06-30`,
        disposalType: 'sale',
        salePrice: '0x' + 'f'.repeat(1e5),
      }),
      asset({
        id: 'ok',
        name: '正常な売却',
        acquisitionDate: `${Y - 2}-01-01`,
        disposedDate: `${Y}-06-30`,
        disposalType: 'sale',
        salePrice: '300000',
      }),
    ]);
    const start = Date.now();
    await mountSettings();
    await waitFor(() => text().includes('16進の売却'), 2000);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(rowOf('16進の売却').querySelector('[role="alert"]')).not.toBeNull();
    expect(text()).toContain(m.settings_transfer_income_unavailable({ names: '16進の売却' }));
    expect(uncaught).toEqual([]);
  });

  test('計算に効く問題の資産があると、償却額・帳簿価額・譲渡所得はすべて「—」にして理由を一覧の上に出す', async () => {
    await db.fixedAssets.bulkAdd([
      asset({ id: 'bad', name: '壊れた資産', acquisitionCost: '0x' + 'f'.repeat(65) }),
      asset({
        id: 'ok',
        name: '正常な売却',
        acquisitionDate: `${Y - 2}-01-01`,
        disposedDate: `${Y}-06-30`,
        disposalType: 'sale',
        salePrice: '300000',
      }),
    ]);
    const start = Date.now();
    await mountSettings();
    await waitFor(() => text().includes('正常な売却'), 2000);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(text()).toContain(m.settings_asset_calc_blocked({ reasons: '' }).slice(0, 10));
    expect(cell('正常な売却', 4)).toBe(m.common_dash());
    expect(cell('正常な売却', 5)).toBe(m.common_dash());
    expect(cell('壊れた資産', 4)).toBe(m.common_dash());
    expect(text()).not.toContain(
      m
        .settings_transfer_income_special_deduction({
          gain: '',
          deduction: '',
          shortTerm: '',
          longTerm: '',
          half: '',
        })
        .slice(0, 6),
    );
    expect(uncaught).toEqual([]);
  });

  test('取得日が数値の資産があっても画面は壊れない', async () => {
    await db.fixedAssets.bulkAdd([
      asset({ id: 'num', name: '数値の取得日', acquisitionDate: 20240101 as never }),
      asset({ id: 'ok' }),
    ]);
    await mountSettings();
    await waitFor(() => text().includes('数値の取得日'));
    expect(cell('通常資産', 4)).toBe(m.common_dash());
    expect(uncaught).toEqual([]);
  });

  test('問題が無ければ画面の償却額と減価償却で書く金額は同じ', async () => {
    await db.fixedAssets.bulkAdd([
      asset({ id: 'a', name: '機械A', acquisitionDate: `${Y}-04-01` }),
      asset({
        id: 'b',
        name: '少額B',
        acquisitionCost: '200000',
        depreciationMethod: 'small-asset-special',
      }),
    ]);
    await mountSettings();
    await waitFor(() => text().includes('機械A'));
    const shown = [cell('機械A', 4), cell('少額B', 4)];
    buttonByText(m.settings_asset_run_button())!.click();
    await waitFor(() => text().includes(m.settings_asset_run_success({ created: 2 })));
    const lines = await db.journalLines.where('side').equals('debit').toArray();
    const written = await Promise.all(
      ['#a', '#b'].map(async (tag) => {
        const entry = (await db.journalEntries.toArray()).find((e) => e.description.includes(tag))!;
        return lines.find((l) => l.entryId === entry.id)!.amount;
      }),
    );
    expect(shown).toEqual(written.map((a) => formatJPY(a)));
  });

  test('除却の日付を消した資産（""）は償却額を表示する', async () => {
    await db.fixedAssets.bulkAdd([
      asset({ id: 'c', name: '戻した資産', disposedDate: '', disposalType: 'scrap' }),
      asset({ id: 'ok' }),
    ]);
    await mountSettings();
    await waitFor(() => text().includes('戻した資産'));
    expect(cell('戻した資産', 4)).not.toBe(m.common_dash());
  });

  test('開業日が日付として読めないと、画面を壊さずに理由を示す', async () => {
    await setSetting('businessStartDate', `${Y}-13-01`);
    await db.fixedAssets.bulkAdd([asset({ id: 'ok' })]);
    await mountSettings();
    await waitFor(() => text().includes('通常資産'));
    expect(text()).toContain(m.business_date_invalid_setting_start({ value: `${Y}-13-01` }));
    expect(cell('通常資産', 4)).toBe(m.common_dash());
    expect(uncaught).toEqual([]);
  });
});

describe('数値の欄（R12・R13）', () => {
  test('減価償却の年を空にすると実行を止めて案内する', async () => {
    await db.fixedAssets.bulkAdd([asset({ id: 'ok' })]);
    await mountSettings();
    await waitFor(() => text().includes('通常資産'));
    type('depreciationTargetNen', '');
    expect(buttonByText(m.settings_asset_run_button())!.disabled).toBe(true);
    expect(text()).toContain(m.common_integer_invalid({ min: 2020, max: 2099 }));
  });

  test('ルールの優先度を空にすると保存せず案内する', async () => {
    await mountSettings();
    type('rulePattern', 'コンビニ');
    type('rulePriority', '');
    field('rulePattern')
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 50));
    expect(text()).toContain(m.settings_rule_priority_invalid());
    expect(await db.parserRules.count()).toBe(0);
  });

  test.each(['-5', 'abc'])(
    '転用の一時所得 %j は案内を出し、譲渡所得の計算に入れない',
    async (v) => {
      await db.fixedAssets.bulkAdd([
        asset({
          id: 'ok',
          name: '正常な売却',
          acquisitionDate: `${Y - 2}-01-01`,
          disposedDate: `${Y}-06-30`,
          disposalType: 'sale',
          salePrice: '300000',
        }),
      ]);
      await mountSettings();
      await waitFor(() => field('transferOccasionalIncome') !== null);
      expect(text()).not.toContain(m.common_amount_invalid());
      const el = field('transferOccasionalIncome');
      Object.defineProperty(el, 'value', { configurable: true, get: () => v, set: () => {} });
      el.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();
      expect(text()).toContain(m.common_amount_invalid());
    },
  );
});
