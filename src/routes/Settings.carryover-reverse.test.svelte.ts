// 前期繰越の取り消しは打消し仕訳を作る操作なので、削除と誤解させない専用の確認を挟むことを見る。
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { applyCarryover } from '../domain/carryover';
import { m } from '../paraglide/messages';
import type { Account } from '../db/types';

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
// 最後に読む homeOfficeAccountRatios に仕込んだ印が出るまで待ち、onMount の読み込み完了を確かめる。
const MOUNT_SENTINEL = 'ZZZ9';

async function seedCarryover(): Promise<void> {
  for (const year of [2025, 2026]) {
    const accs: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year }));
    await db.accounts.bulkPut(accs);
  }
  const entryId = newId();
  await db.journalEntries.add({
    id: entryId,
    date: '2025-01-01',
    year: 2025,
    description: '開業',
    status: 'confirmed',
    source: 'manual',
    createdAt: 1,
    confirmedAt: 1,
  });
  await db.journalLines.bulkAdd(
    (['debit', 'credit'] as const).map((side) => ({
      id: newId(),
      entryId,
      side,
      accountCode: side === 'debit' ? '1130' : '3110',
      amount: '100000',
      amountIndexed: toIndexable('100000'),
      taxRate: 0,
      taxIncluded: false,
      invoiceCompliant: false,
    })),
  );
  await applyCarryover(2026);
}

async function mountSettled(): Promise<void> {
  await db.settings.put({
    key: 'homeOfficeAccountRatios',
    value: { [MOUNT_SENTINEL]: '0.30' },
    updatedAt: Date.now(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Settings, { target: container, props: {} });
  await waitFor(() => (container?.textContent ?? '').includes(MOUNT_SENTINEL));
}

function dialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="alertdialog"]');
}

function dialogButton(label: string): HTMLButtonElement {
  const found = Array.from(dialog()!.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(label),
  );
  if (found === undefined) {
    throw new Error(`ボタンが見つからない: ${label}`);
  }
  return found;
}

async function reversalCount(): Promise<number> {
  return db.journalEntries
    .filter((e) => e.source === 'carryover' && e.originalEntryId !== undefined)
    .count();
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seedCarryover();
  await mountSettled();
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

function openDialog(): Promise<void> {
  container!.querySelector<HTMLButtonElement>('[data-testid="carryover-reverse-button"]')!.click();
  return waitFor(() => dialog() !== null);
}

describe('Settings: 前期繰越の取り消し', () => {
  test('ボタンは「取り消す」系で、確認は削除・元に戻せないとは書かず打消し仕訳として説明する', async () => {
    const button = container!.querySelector('[data-testid="carryover-reverse-button"]')!;
    expect(button.textContent).toContain(m.settings_carryover_delete_button());
    expect(button.textContent).not.toContain('削除');

    await openDialog();
    const text = dialog()!.textContent ?? '';
    expect(text).toContain(m.settings_carryover_delete_confirm_title());
    expect(text).toContain(
      m.settings_carryover_delete_confirm_desc({ name: m.settings_carryover_name({ year: 2026 }) }),
    );
    expect(text).toContain('打消し仕訳');
    expect(text).not.toContain('削除');
    expect(text).not.toContain('元に戻せません');
    expect(dialogButton(m.settings_carryover_delete_button())).toBeDefined();
  });

  test('取り消しをやめると打消し仕訳は作られない', async () => {
    await openDialog();
    dialogButton(m.common_cancel()).click();
    await new Promise((r) => setTimeout(r, 50));
    expect(await reversalCount()).toBe(0);
  });

  test('確認すると打消し仕訳で取り消し、完了メッセージは削除と言わない', async () => {
    await openDialog();
    dialogButton(m.settings_carryover_delete_button()).click();
    await waitFor(() => (container!.textContent ?? '').includes(m.settings_carryover_deleted()));
    expect(m.settings_carryover_deleted()).not.toContain('削除');
    expect(await reversalCount()).toBe(1);
  });
});
