import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { m } from '../paraglide/messages';
import type { FixedAsset } from '../db/types';

vi.mock('../domain/depreciation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domain/depreciation')>()),
  buildDepreciationInputs: () => {
    throw new Error('テスト用の失敗');
  },
}));

const { default: Settings } = await import('./Settings.svelte');

const Y = new Date().getFullYear();
const MOUNT_SENTINEL = 'ZZZ9';
let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

async function waitFor(predicate: () => boolean): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 4000) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

function text(): string {
  return container?.textContent ?? '';
}

function cell(name: string, index: number): string {
  const row = Array.from(container!.querySelectorAll('tbody tr')).find((tr) =>
    tr.querySelector('td')?.textContent?.includes(name),
  );
  return row?.querySelectorAll('td')[index]?.textContent?.trim() ?? '';
}

function asset(id: string, name: string): FixedAsset {
  return {
    id,
    name,
    acquisitionDate: `${Y}-01-01`,
    acquisitionCost: '400000',
    usefulLifeYears: 4,
    depreciationMethod: 'straight-line',
    accountCode: '1510',
  };
}

beforeEach(async () => {
  await db.fixedAssets.clear();
  await db.settings.clear();
});

afterEach(async () => {
  if (instance !== undefined) {
    await unmount(instance);
  }
  container?.remove();
  instance = undefined;
  container = undefined;
});

test('償却額の計算の組み立てに失敗すると、全資産の償却額が「—」になり一覧の上に原因が出る', async () => {
  await db.fixedAssets.bulkAdd([asset('a', '資産その一'), asset('b', '資産その二')]);
  await db.settings.put({
    key: 'homeOfficeAccountRatios',
    value: { [MOUNT_SENTINEL]: '0.30' },
    updatedAt: Date.now(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Settings, { target: container, props: {} });
  await waitFor(() => text().includes(MOUNT_SENTINEL) && text().includes('資産その二'));
  for (const name of ['資産その一', '資産その二']) {
    expect(cell(name, 4)).toBe(m.common_dash());
    expect(cell(name, 5)).toBe(m.common_dash());
  }
  expect(text()).toContain(m.settings_asset_calc_blocked({ reasons: 'テスト用の失敗' }));
  await db.settings.toArray();
});
