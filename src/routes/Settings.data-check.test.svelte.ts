import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { dataCheck } from '../stores/data-check.svelte';
import { m } from '../paraglide/messages';

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
// onMount の読み込みが終わるまで待つための目印。最後に読む設定に入れる。
const MOUNT_SENTINEL = 'ZZZ9';

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function text(): string {
  return container?.textContent ?? '';
}
// シングルトンの状態は前のテストの結果を持ち越すので、データを入れてから点検し直す。
async function mountSettings(): Promise<HTMLElement> {
  await db.settings.put({
    key: 'homeOfficeAccountRatios',
    value: { [MOUNT_SENTINEL]: '0.30' },
    updatedAt: Date.now(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Settings, { target: container, props: {} });
  await waitFor(() => text().includes(MOUNT_SENTINEL));
  await dataCheck.rerun();
  flushSync();
  return container;
}

function rerunButton(): HTMLButtonElement {
  const el = [...container!.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === m.settings_data_check_rerun(),
  );
  if (el === undefined) {
    throw new Error('再点検のボタンが無い');
  }
  return el;
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

describe('保存データの点検の欄', () => {
  test('表名・件数・例と「ほか N 件」を出す', async () => {
    for (let i = 1; i <= 5; i++) {
      await db.table('vendors').put({ id: `v${i}`, name: null });
    }
    await db.table('reportSnapshots').put({ id: 'rs1', year: '2026' });
    await mountSettings();
    await waitFor(() => text().includes(m.settings_data_check_found({ count: 6 })));
    expect(text()).toContain(m.settings_data_check_table({ table: 'vendors', count: 5 }));
    expect(text()).toContain(m.settings_data_check_table({ table: 'reportSnapshots', count: 1 }));
    expect(text()).toContain('v1：name が文字列ではありません（null）');
    expect(text()).toContain(m.settings_data_check_more({ count: 2 }));
    expect(text()).toContain(m.settings_data_check_cannot_fix());
  });

  test('「もう一度点検する」で後から入った問題を反映する', async () => {
    await db.table('vendors').put({ id: 'v1', name: null });
    await mountSettings();
    await waitFor(() => text().includes(m.settings_data_check_found({ count: 1 })));
    await db.table('budgets').put({ year: 2026, month: 1, revenueBudget: 'abc' });
    rerunButton().click();
    flushSync();
    await waitFor(() => text().includes(m.settings_data_check_found({ count: 2 })));
    expect(text()).toContain(m.settings_data_check_table({ table: 'budgets', count: 1 }));
    expect(rerunButton().disabled).toBe(false);
  });

  test('問題が無ければその旨を出す', async () => {
    await mountSettings();
    await waitFor(() => text().includes(m.settings_data_check_ok()));
  });

  test('例に HTML の文字列があっても要素を作らない', async () => {
    const html = '<b id="inj">x</b>';
    await db.table('vendors').put({ id: html, name: 'A', entityType: html });
    await mountSettings();
    await waitFor(() => text().includes(m.settings_data_check_found({ count: 1 })));
    expect(text()).toContain(html);
    expect(document.querySelector('#inj')).toBeNull();
  });
});

describe('処理年度の欄', () => {
  test('保存値が文字列の年度なら 2026 を出す', async () => {
    await db.settings.put({ key: 'currentYear', value: '2027', updatedAt: 1 });
    const c = await mountSettings();
    const year = c.querySelector<HTMLInputElement>('input[name="currentTaxNen"]')!;
    expect(year.value).toBe('2026');
  });

  test('範囲外の年度で送信しても基本設定を何も書かない', async () => {
    await db.settings.put({ key: 'currentYear', value: 2027, updatedAt: 1 });
    const c = await mountSettings();
    const name = c.querySelector<HTMLInputElement>('input[name="jigyoYago"]')!;
    name.value = '青井商店';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    const year = c.querySelector<HTMLInputElement>('input[name="currentTaxNen"]')!;
    year.value = '2019';
    year.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    year.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    flushSync();
    await new Promise((r) => setTimeout(r, 200));
    expect((await db.settings.get('currentYear'))?.value).toBe(2027);
    expect(await db.settings.get('userBusinessName')).toBeUndefined();
    expect(await db.settings.get('userInvoiceNumber')).toBeUndefined();
    expect(text()).not.toContain(m.settings_basic_saved());
  });

  test('基本設定を保存すると、処理年度を置き換えた知らせの記録を消す', async () => {
    await db.settings.bulkPut([
      { key: 'currentYear', value: 2026, updatedAt: 1 },
      { key: 'processingYearResetTo', value: 2026, updatedAt: 1 },
    ]);
    const c = await mountSettings();
    const year = c.querySelector<HTMLInputElement>('input[name="currentTaxNen"]')!;
    year.value = '2027';
    year.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    year.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => text().includes(m.settings_basic_saved()));
    expect((await db.settings.get('currentYear'))?.value).toBe(2027);
    expect(await db.settings.get('processingYearResetTo')).toBeUndefined();
  });
});
