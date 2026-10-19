// 消費税欄は change（フォーカスを外す）で初めて保存される。入力中に閉じると失われるため、
// 未確定の入力がある間は画面が未保存として登録されること、保存の中身は従来どおりであることを見る。
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { getSetting, setSetting } from '../lib/settings';
import { m } from '../paraglide/messages';
import { hasUnsavedChanges } from '../router.svelte';

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
  await waitFor(() => container!.querySelector('input[name="ctBasePeriodSales"]') !== null);
}

function field(name: string): HTMLInputElement {
  const el = container!.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (el === null) {
    throw new Error(`${name} が見付からない`);
  }
  return el;
}

function focusOn(name: string): void {
  field(name).dispatchEvent(new FocusEvent('focus'));
}

function typeInto(name: string, value: string): void {
  const el = field(name);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function commit(name: string): void {
  field(name).dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

async function waitForSaved(): Promise<void> {
  await waitFor(() => (container!.textContent ?? '').includes(m.settings_consumption_tax_saved()));
}

interface Case {
  name: string;
  typed: string;
  key: string;
  seed?: unknown;
  expected: unknown;
}

const CASES: Case[] = [
  {
    name: 'ctRegistrationStartDate',
    typed: '2025-04-01',
    key: 'invoiceRegistrationStartDate',
    expected: '2025-04-01',
  },
  {
    name: 'ctTaxableElectionFrom',
    typed: '2024',
    key: 'taxableElectionPeriod',
    expected: { fromYear: 2024 },
  },
  {
    name: 'ctTaxableElectionTo',
    typed: '2026',
    key: 'taxableElectionPeriod',
    seed: { fromYear: 2024 },
    expected: { fromYear: 2024, toYear: 2026 },
  },
  {
    name: 'ctInheritanceDate',
    typed: '2025-05-06',
    key: 'inheritanceSpecialDate',
    expected: '2025-05-06',
  },
  {
    name: 'ctAdjustedFixedAssetDate',
    typed: '2025-07-08',
    key: 'adjustedFixedAssetDate',
    expected: '2025-07-08',
  },
  {
    name: 'ctShortenedFrom',
    typed: '2025-01-01',
    key: 'shortenedTaxPeriod',
    expected: { from: '2025-01-01' },
  },
  {
    name: 'ctShortenedTo',
    typed: '2025-06-30',
    key: 'shortenedTaxPeriod',
    seed: { from: '2025-01-01' },
    expected: { from: '2025-01-01', to: '2025-06-30' },
  },
  {
    name: 'ctBasePeriodSales',
    typed: '6000000',
    key: 'basePeriodTaxableSales',
    seed: '5000000',
    expected: '6000000',
  },
  {
    name: 'ctSpecifiedPeriodSales',
    typed: '7000000',
    key: 'specifiedPeriodTaxableSales',
    expected: '7000000',
  },
  {
    name: 'ctSimplifiedElectionFiledDate',
    typed: '2025-09-10',
    key: 'simplifiedElectionFiledDate',
    expected: '2025-09-10',
  },
];

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

describe('消費税欄の未確定入力は未保存として登録される', () => {
  test.each(CASES)(
    '$name：input だけでは未保存・保存値は不変、change で解除され従来どおり保存される',
    async (c) => {
      if (c.seed !== undefined) {
        await setSetting(c.key as never, c.seed as never);
      }
      await renderSettings();
      const before = await getSetting(c.key as never);
      expect(hasUnsavedChanges()).toBe(false);

      focusOn(c.name);
      typeInto(c.name, c.typed);
      expect(hasUnsavedChanges()).toBe(true);
      expect(await getSetting(c.key as never)).toEqual(before);

      commit(c.name);
      expect(hasUnsavedChanges()).toBe(false);
      await waitForSaved();
      expect(await getSetting(c.key as never)).toEqual(c.expected);
    },
  );

  test('ctBasePeriodSales に「1200万」を入れて change しても保存済みの値は変わらない', async () => {
    await setSetting('basePeriodTaxableSales', '5000000');
    await renderSettings();
    focusOn('ctBasePeriodSales');
    typeInto('ctBasePeriodSales', '1200万');
    expect(hasUnsavedChanges()).toBe(true);
    commit('ctBasePeriodSales');
    expect(hasUnsavedChanges()).toBe(false);
    await waitForSaved();
    expect(await getSetting('basePeriodTaxableSales')).toBe('5000000');
  });

  test('入力後に元の値へ戻すと（blur なしで）未保存は解除され、再度変えると再登録される', async () => {
    await setSetting('basePeriodTaxableSales', '5000000');
    await renderSettings();
    const original = field('ctBasePeriodSales').value;
    focusOn('ctBasePeriodSales');
    typeInto('ctBasePeriodSales', '1');
    expect(hasUnsavedChanges()).toBe(true);
    typeInto('ctBasePeriodSales', original);
    expect(hasUnsavedChanges()).toBe(false);
    typeInto('ctBasePeriodSales', '2');
    expect(hasUnsavedChanges()).toBe(true);
  });

  test('未確定の入力があるとき blur だけでは未保存は解除されない', async () => {
    await renderSettings();
    focusOn('ctBasePeriodSales');
    typeInto('ctBasePeriodSales', '1');
    expect(hasUnsavedChanges()).toBe(true);
    field('ctBasePeriodSales').dispatchEvent(new FocusEvent('blur'));
    flushSync();
    expect(hasUnsavedChanges()).toBe(true);
  });

  test('未確定の入力を残したままアンマウントすると登録は残らない', async () => {
    await renderSettings();
    focusOn('ctBasePeriodSales');
    typeInto('ctBasePeriodSales', '9');
    expect(hasUnsavedChanges()).toBe(true);
    unmount(instance!);
    instance = undefined;
    expect(hasUnsavedChanges()).toBe(false);
  });
});
