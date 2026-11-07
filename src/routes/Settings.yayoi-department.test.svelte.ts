import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import Encoding from 'encoding-japanese';
import { db } from '../db/db';
import { parseCsv } from '../lib/csv';
import { toIndexable } from '../lib/decimal';
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

async function addEntry(id: string, department?: string, subAccountId?: string): Promise<void> {
  await db.journalEntries.add({
    id,
    date: '2026-04-15',
    year: 2026,
    description: `仕訳 ${id}`,
    status: 'confirmed',
    source: 'manual',
    createdAt: 0,
    confirmedAt: 0,
    ...(department === undefined ? {} : { department }),
  });
  const base = {
    entryId: id,
    amount: '1000',
    amountIndexed: toIndexable('1000'),
    taxRate: 0,
    taxIncluded: true,
    invoiceCompliant: false,
  };
  await db.journalLines.bulkAdd([
    {
      ...base,
      id: `${id}d`,
      side: 'debit',
      accountCode: '5130',
      ...(subAccountId === undefined ? {} : { subAccountId }),
    },
    { ...base, id: `${id}c`, side: 'credit', accountCode: '1130' },
  ]);
}

function departmentCheckbox(c: HTMLElement): HTMLInputElement | undefined {
  const label = [...c.querySelectorAll('label')].find(
    (l) => l.textContent?.trim() === m.settings_accountant_export_yayoi_department(),
  );
  return label?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? undefined;
}

function clickYayoi(c: HTMLElement): void {
  const button = [...c.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === m.settings_accountant_export_yayoi(),
  );
  expect(button).toBeDefined();
  button!.click();
  flushSync();
}

async function exportRows(c: HTMLElement): Promise<string[][]> {
  const calls = saveFile.mock.calls.length;
  clickYayoi(c);
  await waitFor(() => saveFile.mock.calls.length > calls);
  const [data] = saveFile.mock.calls[calls] as unknown as [Uint8Array];
  const text = Encoding.convert(Array.from(data), {
    to: 'UNICODE',
    from: 'SJIS',
    type: 'string',
  });
  return parseCsv(text);
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

describe('弥生形式 CSV の部門', { timeout: 30_000 }, () => {
  test('部門のある仕訳があると選択欄を出し、既定では部門を書き出さず、選ぶと書き出す', async () => {
    await addEntry('e1', '営業');
    const c = await mountSettings();
    await waitFor(() => departmentCheckbox(c) !== undefined);
    const checkbox = departmentCheckbox(c)!;
    expect(checkbox.checked).toBe(false);

    const omitted = await exportRows(c);
    expect(omitted[0]?.[6]).toBe('');
    expect(omitted[0]?.[12]).toBe('');

    checkbox.click();
    flushSync();
    expect(checkbox.checked).toBe(true);
    const included = await exportRows(c);
    expect(included[0]?.[6]).toBe('営業');
    expect(included[0]?.[12]).toBe('営業');
  });

  test('部門のある仕訳が無いときは選択欄を出さない', async () => {
    await addEntry('e1');
    const c = await mountSettings();

    const rows = await exportRows(c);
    expect(rows[0]?.[6]).toBe('');
    expect(departmentCheckbox(c)).toBeUndefined();
    expect(c.textContent).not.toContain(m.settings_accountant_export_yayoi_department_help());
  });

  test('空白だけの部門は選択欄を出さず、部門を書き出さない', async () => {
    await addEntry('e1', '  ');
    const c = await mountSettings();

    const rows = await exportRows(c);
    expect(departmentCheckbox(c)).toBeUndefined();
    expect(c.textContent).not.toContain(m.settings_accountant_export_yayoi_department_help());
    expect(rows[0]?.[6]).toBe('');
    expect(rows[0]?.[12]).toBe('');
  });

  test('名前が長い補助科目の仕訳は、長さの注意を示す', async () => {
    await db.subAccounts.add({ id: 's1', accountCode: '5130', name: 'あ'.repeat(13) });
    await addEntry('e1', undefined, 's1');
    const c = await mountSettings();

    clickYayoi(c);
    await waitFor(() => c.querySelector('[data-testid="yayoi-export-notices"]') !== null);
    const notices = c.querySelector('[data-testid="yayoi-export-notices"]')!;
    expect(notices.textContent).toContain('仕訳 e1');
    expect(notices.textContent).toContain(m.settings_accountant_export_yayoi_reason_length());
  });
});
