import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { setSetting } from '../lib/settings';
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
const YEAR = new Date().getFullYear();

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

function baseAsset(over: Partial<FixedAsset> = {}): FixedAsset {
  return {
    id: 'asset-1',
    name: '賃貸アパート',
    acquisitionDate: `${YEAR - 1}-01-01`,
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
// 保存直後の liveQuery の再読込が終わる前に db.delete() すると購読が止まり、次のテストが古い表示を見る。
// 後から登録した afterEach が先に走る（stack 順）ので、削除の前に待つ。
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 200));
});

describe('設定画面の固定資産の金額は読む側で正規化される', () => {
  test('売価が桁区切り付きで保存された処分済み資産があっても、設定画面を表示できる', async () => {
    await db.fixedAssets.add(
      baseAsset({
        name: '桁区切り売価の機材',
        disposedDate: `${YEAR}-03-31`,
        disposalType: 'sale',
        salePrice: '1,000',
      }),
    );
    await renderSettings();
    await waitFor(() => (container!.textContent ?? '').includes('桁区切り売価の機材'));
    expect(container!.textContent).toContain(m.settings_asset_disposal_run_button());
  });

  test('売価が 100.5 の処分済み資産は、処分仕訳の作成で入力の誤りを示して仕訳を作らない', async () => {
    await db.fixedAssets.add(
      baseAsset({
        disposedDate: `${YEAR}-03-31`,
        disposalType: 'sale',
        salePrice: '100.5',
      }),
    );
    await renderSettings();
    await waitFor(() => (container!.textContent ?? '').includes('賃貸アパート'));
    buttonByText(m.settings_asset_disposal_run_button()).click();
    await waitFor(() => (container!.textContent ?? '').includes(m.common_amount_invalid()));
    expect(await db.journalEntries.count()).toBe(0);
  });
});

describe('設定画面の固定資産の金額は保存時に正規化される', () => {
  test('処分の売価 1,000 と譲渡費用 " 300 " は 1000 と 300 で保存される', async () => {
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

    typeInto('disposeSalePrice', '1,000');
    typeInto('disposeSaleKeihi', ' 300 ');
    saveButtonNear('disposeSalePrice').click();
    await waitFor(async () => (await db.fixedAssets.get('asset-1'))?.disposalType === 'sale');
    const stored = await db.fixedAssets.get('asset-1');
    expect(stored?.salePrice).toBe('1000');
    expect(stored?.saleExpenses).toBe('300');
  });

  test('不動産の年租金 1,200,000 は 1200000 で保存される', async () => {
    await db.fixedAssets.add(
      baseAsset({
        incomeType: 'realEstate',
        realEstateDetail: { propertyType: '貸家', address: '東京都', annualRent: '1' },
      }),
    );
    await renderSettings();
    await waitFor(() => (container!.textContent ?? '').includes('賃貸アパート'));
    buttonByText(m.settings_asset_property_button()).click();
    await waitFor(() => container!.querySelector('input[name="propertyAnnualRent"]') !== null);

    typeInto('propertyAnnualRent', '1,200,000');
    saveButtonNear('propertyAnnualRent').click();
    await waitFor(
      async () =>
        (await db.fixedAssets.get('asset-1'))?.realEstateDetail?.annualRent !== undefined &&
        (await db.fixedAssets.get('asset-1'))?.realEstateDetail?.annualRent !== '1',
    );
    expect((await db.fixedAssets.get('asset-1'))?.realEstateDetail?.annualRent).toBe('1200000');
  });
});

function rowButton(assetName: string, text: string): HTMLButtonElement {
  const row = Array.from(container!.querySelectorAll('tr')).find((r) =>
    (r.textContent ?? '').includes(assetName),
  );
  const el = Array.from(row?.querySelectorAll('button') ?? []).find(
    (b) => (b.textContent ?? '').trim() === text,
  );
  if (el === undefined) {
    throw new Error(`button ${text} not found in ${assetName}`);
  }
  return el;
}

describe('文字列でない値が入った固定資産も、編集画面から保存して文字列に直せる', () => {
  test('売価が数値 1000 の処分済み資産は、編集してそのまま保存すると文字列 "1000" になる', async () => {
    await db.fixedAssets.add(
      baseAsset({
        id: 'asset-n3-sale',
        name: '数値売価の機材',
        disposedDate: `${YEAR}-03-31`,
        disposalType: 'sale',
        salePrice: 1000 as unknown as string,
      }),
    );
    await renderSettings();
    await waitFor(() => (container!.textContent ?? '').includes('数値売価の機材'));
    rowButton('数値売価の機材', m.settings_action_edit()).click();
    await waitFor(() => container!.querySelector('input[name="disposeSalePrice"]') !== null);
    expect(field('disposeSalePrice').value).toBe('1000');

    saveButtonNear('disposeSalePrice').click();
    await waitFor(
      async () => typeof (await db.fixedAssets.get('asset-n3-sale'))?.salePrice === 'string',
    );
    expect((await db.fixedAssets.get('asset-n3-sale'))?.salePrice).toBe('1000');
  });

  test('物件明細の一部が数値の資産は、物件明細を開いてそのまま保存すると文字列になる', async () => {
    await db.fixedAssets.add(
      baseAsset({
        id: 'asset-n3-property',
        name: '数値入りの賃貸物件',
        incomeType: 'realEstate',
        realEstateDetail: {
          propertyType: 123,
          address: '東京都',
          annualRent: 1200000,
          areaSqm: 45,
        } as unknown as NonNullable<FixedAsset['realEstateDetail']>,
      }),
    );
    await renderSettings();
    await waitFor(() => (container!.textContent ?? '').includes('数値入りの賃貸物件'));
    rowButton('数値入りの賃貸物件', m.settings_asset_property_button()).click();
    await waitFor(() => container!.querySelector('input[name="propertyAnnualRent"]') !== null);

    saveButtonNear('propertyAnnualRent').click();
    await waitFor(
      async () =>
        typeof (await db.fixedAssets.get('asset-n3-property'))?.realEstateDetail?.propertyType ===
        'string',
    );
    const detail = (await db.fixedAssets.get('asset-n3-property'))?.realEstateDetail;
    expect(detail?.propertyType).toBe('123');
    expect(detail?.annualRent).toBe('1200000');
    expect(detail?.areaSqm).toBe('45');
  });
});
