import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { m } from '../paraglide/messages';

const { default: Settings } = await import('./Settings.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const MOUNT_SENTINEL = 'ZZZ9';

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function field(name: string): HTMLInputElement {
  return container!.querySelector<HTMLInputElement>(`[name="${name}"]`) as HTMLInputElement;
}

function type(name: string, value: string): void {
  const el = field(name);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function saveButtonNear(name: string): HTMLButtonElement {
  const editor = field(name).closest('div')!.parentElement!;
  return Array.from(editor.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === m.settings_action_save(),
  )!;
}

function buttonByText(label: string): HTMLButtonElement {
  return Array.from(container!.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label,
  )!;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.settings.put({
    key: 'homeOfficeAccountRatios',
    value: { [MOUNT_SENTINEL]: '0.30' },
    updatedAt: Date.now(),
  });
  await db.fixedAssets.add({
    id: 'a1',
    name: '賃貸アパート',
    acquisitionDate: '2025-04-01',
    acquisitionCost: '3000000',
    usefulLifeYears: 22,
    depreciationMethod: 'straight-line',
    accountCode: '1520',
    incomeType: 'realEstate',
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Settings, { target: container, props: {} });
  await waitFor(() => {
    const text = container!.textContent ?? '';
    return text.includes(MOUNT_SENTINEL) && text.includes('賃貸アパート');
  });
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

describe('固定資産の不動産・売却欄の金額', () => {
  test.each([
    ['propertyMensekiSqm', '-5'],
    ['propertyKeyMoneyEtc', '-5'],
    ['propertyOtherIncome', '-5'],
    ['propertyDepositBalance', '-5'],
    ['propertyAnnualRent', '-5'],
  ])('不動産の %s に %j を入れると保存せず、編集も閉じない', async (name, bad) => {
    buttonByText(m.settings_asset_property_button()).click();
    flushSync();
    type('propertyType', '共同住宅');
    type('propertyJusho', '東京都');
    type('propertyAnnualRent', '1200000');
    type(name, bad);
    expect(container!.textContent).toContain(m.common_amount_invalid());
    saveButtonNear('propertyAnnualRent').click();
    await new Promise((r) => setTimeout(r, 50));
    expect((await db.fixedAssets.get('a1'))?.realEstateDetail).toBeUndefined();
    expect(field('propertyAnnualRent')).not.toBeNull();
  });

  test('読める値は半角の標準の形で保存される', async () => {
    buttonByText(m.settings_asset_property_button()).click();
    flushSync();
    type('propertyType', '共同住宅');
    type('propertyJusho', '東京都');
    type('propertyAnnualRent', '1,200,000');
    type('propertyMensekiSqm', '45.5');
    saveButtonNear('propertyAnnualRent').click();
    await waitFor(() => field('propertyAnnualRent') === null);
    const detail = (await db.fixedAssets.get('a1'))?.realEstateDetail;
    expect(detail?.annualRent).toBe('1200000');
    expect(detail?.areaSqm).toBe('45.5');
  });

  test.each([
    ['disposeSalePrice', '-5'],
    ['disposeSaleKeihi', '-5'],
  ])('売却の %s に %j を入れると保存しない', async (name, bad) => {
    buttonByText(m.settings_asset_disposal_button()).click();
    flushSync();
    container!.querySelector<HTMLInputElement>('input[type="radio"][value="sale"]')!.click();
    flushSync();
    type('disposeSalePrice', '100000');
    type(name, bad);
    expect(container!.textContent).toContain(m.common_amount_invalid());
    saveButtonNear('disposeSalePrice').click();
    await new Promise((r) => setTimeout(r, 50));
    expect((await db.fixedAssets.get('a1'))?.disposalType).toBeUndefined();
  });
});
