import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { generateDisposalEntry } from '../domain/asset-disposal';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { m } from '../paraglide/messages';

const { saveFile } = vi.hoisted(() => ({
  saveFile: vi.fn(async () => 'unknown' as const),
}));
vi.mock('../lib/save-file', () => ({ saveFile }));

const { default: Settings } = await import('./Settings.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}
// onMount の読み込みが終わるまで待つための目印。最後に読む設定に入れる。
const MOUNT_SENTINEL = 'ZZZ9';

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

async function mountSettings(): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Settings, { target: container, props: {} });
  await waitFor(() => (container!.textContent ?? '').includes(MOUNT_SENTINEL));
  return container;
}

function clickYayoi(c: HTMLElement): void {
  const button = [...c.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === m.settings_accountant_export_yayoi(),
  );
  expect(button).toBeDefined();
  button!.click();
  flushSync();
}

beforeEach(async () => {
  saveFile.mockClear();
  await db.delete();
  await db.open();
  await db.accounts.bulkAdd(ACCOUNTS_2026);
  await db.settings.bulkPut([
    { key: 'currentYear', value: 2026, updatedAt: Date.now() },
    { key: 'homeOfficeAccountRatios', value: { [MOUNT_SENTINEL]: '0.30' }, updatedAt: Date.now() },
  ]);
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

describe('弥生形式 CSV の書き出し後の注意', { timeout: 30_000 }, () => {
  test('売却した資産が見つからない事業主借の課税売上は、その理由を示す', async () => {
    await db.fixedAssets.add({
      id: 'asset-0001',
      name: 'ノートPC',
      acquisitionDate: '2026-01-10',
      acquisitionCost: '150000',
      usefulLifeYears: 3,
      depreciationMethod: 'lump-sum',
      accountCode: '1510',
      disposalType: 'sale',
      disposedDate: '2026-06-01',
      salePrice: '110000',
      essentialToBusiness: true,
    });
    expect((await generateDisposalEntry('asset-0001')).created).toBe(true);
    await db.fixedAssets.delete('asset-0001');
    const c = await mountSettings();

    clickYayoi(c);
    await waitFor(() => c.querySelector('[data-testid="yayoi-export-notices"]') !== null);
    const notices = c.querySelector('[data-testid="yayoi-export-notices"]')!;
    expect(notices.textContent).toContain('固定資産売却 ノートPC #asset-00');
    expect(notices.textContent).toContain(m.settings_accountant_export_yayoi_reason_transfer());
    expect(notices.textContent).not.toContain(m.settings_accountant_export_yayoi_reason_amount());
  });
});
