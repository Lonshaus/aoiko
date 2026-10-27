import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
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

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function field<T extends HTMLElement = HTMLInputElement>(name: string): T {
  return container!.querySelector<T>(`[name="${name}"]`) as T;
}

function type(name: string, value: string): void {
  const el = field(name);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function choose(name: string, value: string): void {
  const el = field<HTMLSelectElement>(name);
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

function text(): string {
  return container!.textContent ?? '';
}

function buttonByText(label: string): HTMLButtonElement {
  return Array.from(container!.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label,
  )!;
}

function asset(overrides: Partial<FixedAsset>): FixedAsset {
  return {
    id: 'ok',
    name: '正常な PC',
    acquisitionDate: '2026-01-01',
    acquisitionCost: '300000',
    usefulLifeYears: 4,
    depreciationMethod: 'straight-line',
    accountCode: '1510',
    ...overrides,
  };
}
// onMount の読み込みが終わる前に DB を消すと後続のテストが壊れるため、最後に読まれる設定の表示を待つ
const MOUNT_SENTINEL = 'ZZZ9';

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

async function submitAsset(): Promise<void> {
  field('assetAcquisitionCost')
    .closest('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 50));
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
  container?.remove();
  container = undefined;
  await db.delete();
});

describe('固定資産の追加フォーム', () => {
  test.each([
    ['-5', m.common_amount_invalid()],
    ['1e3', m.common_amount_invalid()],
    ['100000000000000', m.common_amount_too_large()],
  ])('取得価額 %j は案内を出して登録しない', async (cost, message) => {
    await mountSettings();
    type('assetTitle', '機械');
    type('assetAcquisitionCost', cost);
    expect(text()).toContain(message);
    await submitAsset();
    expect(await db.fixedAssets.count()).toBe(0);
  });

  test('残価保証額 -5 は案内を出して登録しない', async () => {
    await mountSettings();
    type('assetTitle', '機械');
    type('assetAcquisitionCost', '500000');
    type('assetResidualGuarantee', '-5');
    expect(text()).toContain(m.common_amount_invalid());
    await submitAsset();
    expect(await db.fixedAssets.count()).toBe(0);
  });

  test('リース期間定額法で月数が空欄なら案内を出して登録しない', async () => {
    await mountSettings();
    type('assetTitle', 'リース機械');
    type('assetAcquisitionCost', '500000');
    choose('assetMethod', 'lease-period-straight-line');
    expect(text()).toContain(m.fixed_asset_issue_lease_term());
    await submitAsset();
    expect(await db.fixedAssets.count()).toBe(0);
  });

  test('定率法で耐用年数 25 なら案内を出して登録しない', async () => {
    await mountSettings();
    type('assetTitle', '機械');
    type('assetAcquisitionCost', '500000');
    choose('assetMethod', 'declining-balance');
    type('assetUsefulLife', '25');
    expect(text()).toContain(m.fixed_asset_issue_useful_life());
    await submitAsset();
    expect(await db.fixedAssets.count()).toBe(0);
  });

  test('読める値は標準の形で登録し、リース月数は整数で保存する', async () => {
    await mountSettings();
    type('assetTitle', 'リース機械');
    type('assetAcquisitionCost', '500000');
    choose('assetMethod', 'lease-period-straight-line');
    type('assetLeaseTermMonths', '60');
    await submitAsset();
    const [saved] = await db.fixedAssets.toArray();
    expect(saved?.acquisitionCost).toBe('500000');
    expect(saved?.leaseTermMonths).toBe(60);
  });
});

describe('保存済みの固定資産に読めない値があるとき', () => {
  const bad: Array<[string, Partial<FixedAsset>]> = [
    [
      '一括償却の取得価額',
      { depreciationMethod: 'lump-sum', acquisitionCost: 'abc', lumpSumPoolId: 'p' },
    ],
    ['売却価格', { disposedDate: '2026-06-30', disposalType: 'sale', salePrice: 'abc' }],
    ['未償却残高', { conversionBasis: 'abc' }],
    ['残価保証額', { leaseContractDate: '2026-01-01', residualGuaranteeAmount: 'abc' }],
    ['耐用年数', { usefulLifeYears: 'abc' as unknown as number }],
    ['極小の指数', { acquisitionCost: '1e-5000' }],
  ];

  test.each(bad)('%s：画面は落ちずに理由を示し、復元欄も出る', async (_label, overrides) => {
    await db.fixedAssets.bulkAdd([
      asset({}),
      asset({ id: 'bad', name: '壊れた資産', ...overrides }),
    ]);
    await mountSettings();
    await waitFor(() => text().includes('壊れた資産'));
    expect(container!.querySelector('[role="alert"]')).not.toBeNull();
    expect(text()).toContain('正常な PC');
    expect(text()).toContain(m.settings_restore_title());
  });
  // 売却価格はその資産の売却だけに効き、償却額は変えないため、減価償却は止めない
  const computeBad = bad.filter(([label]) => label !== '売却価格');

  test('売却価格だけ読めない資産があっても減価償却仕訳は作る', async () => {
    await db.fixedAssets.bulkAdd([
      asset({}),
      asset({
        id: 'bad',
        name: '壊れた資産',
        disposedDate: '2026-06-30',
        disposalType: 'sale',
        salePrice: 'abc',
      }),
    ]);
    await mountSettings();
    await waitFor(() => text().includes('壊れた資産'));
    buttonByText(m.settings_asset_run_button()).click();
    await waitFor(() => text().includes(m.settings_asset_run_success({ created: 2 })));
    expect(await db.journalEntries.count()).toBe(2);
  });

  test.each(computeBad)(
    '%s：減価償却仕訳を 1 件も作らず資産名を示す',
    async (_label, overrides) => {
      await db.fixedAssets.bulkAdd([
        asset({}),
        asset({ id: 'bad', name: '壊れた資産', ...overrides }),
      ]);
      await mountSettings();
      await waitFor(() => text().includes('壊れた資産'));
      buttonByText(m.settings_asset_run_button()).click();
      await waitFor(() =>
        text().includes('⚠ ' + m.fixed_asset_invalid({ name: '壊れた資産', reasons: '' })),
      );
      expect(await db.journalEntries.count()).toBe(0);
    },
  );

  test('売却価格を読めない資産の売却仕訳は作らず理由を示す', async () => {
    await db.fixedAssets.add(
      asset({
        id: 'bad',
        name: '売却した車',
        disposedDate: '2026-06-30',
        disposalType: 'sale',
        salePrice: 'abc',
      }),
    );
    await mountSettings();
    await waitFor(() => text().includes('売却した車'));
    buttonByText(m.settings_asset_disposal_run_button()).click();
    await waitFor(() =>
      text().includes(
        m.fixed_asset_issue_amount({ field: m.settings_asset_disposal_sale_price_placeholder() }),
      ),
    );
    expect(await db.journalEntries.count()).toBe(0);
  });
});
