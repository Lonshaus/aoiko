import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { newId } from '../lib/id';
import { setSetting } from '../lib/settings';
import { buildPayload } from '../backup/payload';
import { restoreFromPayload } from '../domain/restore';
import { stashRestoreNotice } from '../lib/restore-notice';
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
// onMount の読み込みが終わる前に DB を消すと後続のテストが壊れるため、最後に読まれる設定の表示を待つ
const MOUNT_SENTINEL = 'ZZZ9';

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function text(): string {
  return container?.textContent ?? '';
}

function field(name: string): HTMLInputElement {
  return container!.querySelector<HTMLInputElement>(`[name="${name}"]`) as HTMLInputElement;
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

async function seedLine(amount: unknown, description: string): Promise<void> {
  const entryId = newId();
  await db.journalEntries.add({
    id: entryId,
    date: '2026-03-01',
    year: 2026,
    description,
    status: 'confirmed',
    source: 'manual',
    createdAt: 1,
    confirmedAt: 1,
  });
  await db.journalLines.add({
    id: newId(),
    entryId,
    side: 'debit',
    accountCode: '5150',
    amount: amount as string,
    amountIndexed: '1000000000000000.00',
    taxRate: 0,
    taxIncluded: true,
    invoiceCompliant: false,
  });
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

describe('復元後の過大な明細の一覧', () => {
  test('1e15 の明細を含むバックアップは戻せて、再読み込み後の設定画面に一覧が出る', async () => {
    await seedLine('1e15', '桁あふれ取引');
    const payload = await buildPayload();
    await db.delete();
    await db.open();
    await restoreFromPayload(payload, new Map());
    stashRestoreNotice({ tables: 1, rows: 1, missingBlobCount: 0 });
    await mountSettings();
    expect(text()).toContain('桁あふれ取引');
    expect(text()).toContain(m.settings_restore_success({ tables: 1, rows: 1 }));
  });

  test('文字列でない金額も一覧に出て、他の設定は読み終わる', async () => {
    await seedLine(5000, '数値の明細');
    stashRestoreNotice({ tables: 1, rows: 1, missingBlobCount: 0 });
    await mountSettings();
    expect(text()).toContain('数値の明細');
  });

  test('復元の通知が無ければ一覧を出さない', async () => {
    await seedLine('1e15', '桁あふれ取引');
    await mountSettings();
    expect(text()).not.toContain('桁あふれ取引');
  });
});

describe('復元された消費税の金額設定', () => {
  test('数値の基準期間の課税売上高は文字列で見せて誤りを示し、保存しても例外にならない', async () => {
    await setSetting('taxRegistration', 'taxable');
    await setSetting('basePeriodTaxableSales', 5000 as unknown as string);
    await mountSettings();
    expect(field('ctBasePeriodSales').value).toBe('5000');
    expect(text()).toContain(m.common_stored_amount_unreadable());
    field('ctBasePeriodSales').dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    await new Promise((r) => setTimeout(r, 100));
    expect((await db.settings.get('basePeriodTaxableSales'))?.value).toBe('5000');
    expect(text()).not.toContain(m.common_stored_amount_unreadable());
  });

  test('オブジェクトの値は空欄にして誤りを示す', async () => {
    await setSetting('taxRegistration', 'taxable');
    await setSetting('basePeriodTaxableSales', {} as unknown as string);
    await mountSettings();
    expect(field('ctBasePeriodSales').value).toBe('');
    expect(text()).toContain(m.common_stored_amount_unreadable());
  });
});
