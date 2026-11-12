import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { setSetting } from '../lib/settings';
import { m } from '../paraglide/messages';
import type { FixedAsset } from '../db/types';

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

function text(): string {
  return container?.textContent ?? '';
}

function buttonByText(label: string): HTMLButtonElement | undefined {
  return Array.from(container!.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label,
  );
}

const converted: FixedAsset = {
  id: 'conv',
  name: '取得日の誤った転用資産',
  acquisitionDate: '2026-09-01',
  acquisitionCost: '300000',
  conversionBasis: '344820',
  serviceStartDate: '2026-07-01',
  usefulLifeYears: 4,
  depreciationMethod: 'straight-line',
  accountCode: '1510',
  source: 'opening',
  openingYear: 2026,
};

beforeEach(async () => {
  await db.delete();
  await db.open();
  await setSetting('currentYear', 2026);
  await db.settings.put({
    key: 'homeOfficeAccountRatios',
    value: { [MOUNT_SENTINEL]: '0.30' },
    updatedAt: Date.now(),
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

describe('開業時未償却残高が取得価額を超える保存済みの資産（G4）', () => {
  test('資産一覧の上と減価償却の結果に資産名と直し方を示し、減価償却は止めない', async () => {
    await db.fixedAssets.add(converted);
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Settings, { target: container, props: {} });
    await waitFor(() => text().includes(MOUNT_SENTINEL));
    const notice = m.settings_asset_conversion_basis_exceeds_cost({ names: converted.name });
    await waitFor(() => text().includes(notice));
    const year = container!.querySelector<HTMLInputElement>('[name="depreciationTargetNen"]')!;
    year.value = '2026';
    year.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    buttonByText(m.settings_asset_run_button())!.click();
    await waitFor(() => text().includes(m.settings_asset_run_success({ created: 1 })));
    expect(text().split(notice).length - 1).toBe(2);
  });
});
