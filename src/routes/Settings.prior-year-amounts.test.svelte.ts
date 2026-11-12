import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { newId } from '../lib/id';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { m } from '../paraglide/messages';
import type { Account, JournalLine } from '../db/types';

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

type Spec = Array<[string, 'debit' | 'credit', unknown]>;

async function seedPriorYear(entries: Array<{ description: string; lines: Spec }>): Promise<void> {
  for (const year of [2025, 2026]) {
    const accs: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year }));
    await db.accounts.bulkPut(accs);
  }
  for (const e of entries) {
    const entryId = newId();
    await db.journalEntries.add({
      id: entryId,
      date: '2025-03-01',
      year: 2025,
      description: e.description,
      status: 'confirmed',
      source: 'manual',
      createdAt: 1,
      confirmedAt: 1,
    });
    await db.journalLines.bulkAdd(
      e.lines.map(
        ([accountCode, side, amount]) =>
          ({
            id: newId(),
            entryId,
            side,
            accountCode,
            amount,
            amountIndexed: '00000000000000.00',
            taxRate: 0,
            taxIncluded: false,
            invoiceCompliant: false,
          }) as JournalLine,
      ),
    );
  }
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

function buttonByText(label: string): HTMLButtonElement {
  const found = Array.from(container!.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label,
  );
  if (found === undefined) {
    throw new Error(`ボタンが見つからない: ${label}`);
  }
  return found;
}

async function snapshot(): Promise<string> {
  return JSON.stringify({
    entries: await db.journalEntries.orderBy('id').toArray(),
    lines: await db.journalLines.orderBy('id').toArray(),
    settings: await db.settings.orderBy('key').toArray(),
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

const badLines = (groups: Spec[]) =>
  groups.flat().filter(([, , amount]) => amount === 'abc' || amount === '100000000000000').length;

const CASES: Array<[string, Spec[]]> = [
  [
    '前年の明細が読めない',
    [
      [
        ['1130', 'debit', 'abc'],
        ['3110', 'credit', '100000'],
      ],
    ],
  ],
  [
    '前年の明細が 100 兆円以上',
    [
      [
        ['1130', 'debit', '100000000000000'],
        ['3110', 'credit', '100000000000000'],
      ],
    ],
  ],
  [
    '100 兆円以上の明細 2 件が相殺されて 100 兆円を下回る',
    [
      [
        ['1130', 'debit', '100000000000000'],
        ['4110', 'credit', '100000000000000'],
      ],
      [
        ['4110', 'debit', '100000000000000'],
        ['1130', 'credit', '100000000000000'],
      ],
    ],
  ],
];

describe('前年の明細から金額を取る操作は、読めない値・100 兆円以上の明細で始めない', () => {
  test.each(CASES)(
    '%s：繰越の確認・実行を止め、位置を示し、データを変えない',
    async (_name, groups) => {
      await seedPriorYear(groups.map((lines) => ({ description: '前年の壊れた取引', lines })));
      await mountSettled();
      const before = await snapshot();
      for (const label of [
        m.settings_carryover_preview_button(),
        m.settings_carryover_apply_button(),
      ]) {
        buttonByText(label).click();
        await new Promise((r) => setTimeout(r, 50));
        const head = m.oversized_amounts_found({ count: badLines(groups), items: '' });
        await waitFor(() => (container?.textContent ?? '').includes(head));
        expect(container!.textContent).toContain('前年の壊れた取引');
        expect(container!.textContent).not.toContain('DecimalError');
        expect(container!.querySelector('[role="alertdialog"]')).toBeNull();
        expect(await snapshot()).toBe(before);
      }
      expect(container!.textContent).not.toContain(m.settings_carryover_applied());
    },
  );

  test.each(CASES)(
    '%s：貸倒引当金の繰戻しを止め、位置を示し、データを変えない',
    async (_name, groups) => {
      await seedPriorYear(groups.map((lines) => ({ description: '前年の壊れた取引', lines })));
      await mountSettled();
      const before = await snapshot();
      container!.querySelector<HTMLButtonElement>('[data-testid="bad-debt-reversal-run"]')!.click();
      await waitFor(() => (container?.textContent ?? '').includes('前年の壊れた取引'));
      expect(container!.textContent).not.toContain('DecimalError');
      expect(container!.querySelector('[role="alertdialog"]')).toBeNull();
      expect(await snapshot()).toBe(before);
    },
  );

  test('前年が正常なら従来どおり繰越を確認できる', async () => {
    await seedPriorYear([
      {
        description: '前年の正常な取引',
        lines: [
          ['1130', 'debit', '100000'],
          ['3110', 'credit', '100000'],
        ],
      },
    ]);
    await mountSettled();
    buttonByText(m.settings_carryover_preview_button()).click();
    await waitFor(() =>
      (container?.textContent ?? '').includes(m.settings_carryover_assets_label()),
    );
    expect(container!.textContent).not.toContain('前年の正常な取引');
  });
});
