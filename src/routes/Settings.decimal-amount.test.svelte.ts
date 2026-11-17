import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { getSetting, setSetting } from '../lib/settings';
import { m } from '../paraglide/messages';
import type { FixedAsset } from '../db/types';

const { default: Settings } = await import('./Settings.svelte');

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const MOUNT_SENTINEL = 'ZZZ9';

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

async function renderSettings(): Promise<void> {
  await setSetting('taxRegistration', 'taxable');
  await db.settings.put({
    key: 'homeOfficeAccountRatios',
    value: { [MOUNT_SENTINEL]: '0.30' },
    updatedAt: Date.now(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Settings, { target: container, props: {} });
  await waitFor(() => (container!.textContent ?? '').includes(MOUNT_SENTINEL));
}

function field(name: string): HTMLInputElement {
  const el = container!.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (el === null) {
    throw new Error(`${name} が見付からない`);
  }
  return el;
}

function typeInto(name: string, value: string): void {
  const el = field(name);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function buttonByText(text: string): HTMLButtonElement {
  const el = Array.from(container!.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === text,
  );
  if (el === undefined) {
    throw new Error(`button ${text} not found`);
  }
  return el;
}

function saveButtonNear(name: string): HTMLButtonElement {
  const row = field(name).closest('td')!;
  const el = Array.from(row.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === m.settings_action_save(),
  );
  if (el === undefined) {
    throw new Error('save button not found');
  }
  return el;
}

function rowErrorShown(name: string): boolean {
  return (field(name).closest('td')?.textContent ?? '').includes(m.common_amount_invalid());
}

const settle = () => new Promise((r) => setTimeout(r, 50));

function baseAsset(over: Partial<FixedAsset> = {}): FixedAsset {
  return {
    id: 'asset-1',
    name: '賃貸アパート',
    acquisitionDate: '2026-01-01',
    acquisitionCost: '1000000',
    usefulLifeYears: 10,
    depreciationMethod: 'straight-line',
    accountCode: '1510',
    ...over,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
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
});

describe('設定画面の金額欄は円単位の整数だけを保存する', () => {
  test('不動産の年租金に小数を入力して保存すると、エラーを表示して realEstateDetail を変えない', async () => {
    const detail = { propertyType: '貸家', address: '東京都', annualRent: '1200000' };
    await db.fixedAssets.add(
      baseAsset({ incomeType: 'realEstate', realEstateDetail: { ...detail } }),
    );
    await renderSettings();
    await waitFor(() => (container!.textContent ?? '').includes('賃貸アパート'));
    buttonByText(m.settings_asset_property_button()).click();
    await waitFor(() => container!.querySelector('input[name="propertyAnnualRent"]') !== null);

    typeInto('propertyAnnualRent', '100.5');
    saveButtonNear('propertyAnnualRent').click();
    await waitFor(() => rowErrorShown('propertyAnnualRent'));
    await settle();
    expect((await db.fixedAssets.get('asset-1'))?.realEstateDetail).toEqual(detail);

    typeInto('propertyAnnualRent', '100');
    saveButtonNear('propertyAnnualRent').click();
    await waitFor(
      async () => (await db.fixedAssets.get('asset-1'))?.realEstateDetail?.annualRent === '100',
    );
  });

  test('処分の売却価額に小数を入力して保存すると、エラーを表示して何も書き込まない', async () => {
    await db.fixedAssets.add(baseAsset());
    await renderSettings();
    await waitFor(() => (container!.textContent ?? '').includes('賃貸アパート'));
    buttonByText(m.settings_asset_disposal_button()).click();
    await waitFor(() => container!.querySelector('input[name="disposeDate"]') !== null);
    const sale = Array.from(
      field('disposeDate').closest('td')!.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ).find((r) => r.value === 'sale')!;
    sale.click();
    await waitFor(() => container!.querySelector('input[name="disposeSalePrice"]') !== null);

    typeInto('disposeSalePrice', '100.5');
    saveButtonNear('disposeSalePrice').click();
    await waitFor(() => rowErrorShown('disposeSalePrice'));
    await settle();
    const stored = await db.fixedAssets.get('asset-1');
    expect(stored?.disposedDate).toBeUndefined();
    expect(stored?.salePrice).toBeUndefined();

    typeInto('disposeSalePrice', '100');
    saveButtonNear('disposeSalePrice').click();
    await waitFor(async () => (await db.fixedAssets.get('asset-1'))?.salePrice === '100');
  });

  test('消費税の基準期間の課税売上高に小数を入力すると、エラーを表示して保存しない', async () => {
    await setSetting('basePeriodTaxableSales', '5000000');
    await renderSettings();
    await waitFor(() => container!.querySelector('input[name="ctBasePeriodSales"]') !== null);
    const input = field('ctBasePeriodSales');
    input.dispatchEvent(new FocusEvent('focus'));
    typeInto('ctBasePeriodSales', '100.5');
    input.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(input.parentElement?.textContent).toContain(m.common_amount_invalid());
    await settle();
    expect(await getSetting('basePeriodTaxableSales')).toBe('5000000');
  });
});
