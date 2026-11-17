import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { unzipSync } from 'fflate';
import { db } from '../db/db';
import { toIndexable } from '../lib/decimal';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { m } from '../paraglide/messages';
import type { JournalEntry, JournalLine } from '../db/types';

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

function entry(id: string, description: string): JournalEntry {
  return {
    id,
    date: '2026-04-15',
    year: 2026,
    description,
    status: 'confirmed',
    source: 'manual',
    createdAt: 0,
    confirmedAt: 0,
  };
}

function line(id: string, entryId: string, side: 'debit' | 'credit', amount = '1000'): JournalLine {
  return {
    id,
    entryId,
    side,
    accountCode: side === 'debit' ? '5130' : '1130',
    amount,
    amountIndexed: toIndexable(amount),
    taxRate: 0,
    taxIncluded: true,
    invoiceCompliant: false,
  };
}

async function seedSingles(count: number): Promise<void> {
  const entries: JournalEntry[] = [];
  const lines: JournalLine[] = [];
  for (let n = 1; n <= count; n++) {
    const id = `e${String(n).padStart(5, '0')}`;
    entries.push(entry(id, `仕訳${n}`));
    lines.push(line(`${id}d`, id, 'debit'), line(`${id}c`, id, 'credit'));
  }
  await db.journalEntries.bulkAdd(entries);
  await db.journalLines.bulkAdd(lines);
}

async function seedWideEntry(description: string): Promise<void> {
  const id = 'wide';
  await db.journalEntries.add(entry(id, description));
  const lines: JournalLine[] = [];
  for (let i = 0; i < 21; i++) {
    lines.push(line(`${id}d${i}`, id, 'debit'));
  }
  lines.push(line(`${id}c`, id, 'credit', '21000'));
  await db.journalLines.bulkAdd(lines);
}

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

describe('弥生形式 CSV の書き出し', { timeout: 30_000 }, () => {
  test('1 ファイルに収まる年度は CSV をそのまま保存する', async () => {
    await seedSingles(3);
    const c = await mountSettings();

    clickYayoi(c);
    await waitFor(() => saveFile.mock.calls.length > 0);
    expect(saveFile).toHaveBeenCalledTimes(1);
    const [data, filename, mime] = saveFile.mock.calls[0] as unknown as [
      Uint8Array,
      string,
      string,
    ];
    expect(data).toBeInstanceOf(Uint8Array);
    expect(filename).toBe('aoiko-yayoi-2026.csv');
    expect(mime).toBe('text/csv');
    expect(c.textContent).not.toContain(m.settings_accountant_export_yayoi_split({ count: 2 }));
  });

  test('1000 列を超える年度は分割した CSV を zip にまとめて保存し、分割を知らせる', async () => {
    await seedSingles(1001);
    const c = await mountSettings();

    clickYayoi(c);
    await waitFor(() => saveFile.mock.calls.length > 0);
    expect(saveFile).toHaveBeenCalledTimes(1);
    const [data, filename, mime] = saveFile.mock.calls[0] as unknown as [
      Uint8Array,
      string,
      string,
    ];
    expect(filename).toBe('aoiko-yayoi-2026.zip');
    expect(mime).toBe('application/zip');
    expect(Object.keys(unzipSync(data)).sort()).toEqual([
      'aoiko-yayoi-2026-1.csv',
      'aoiko-yayoi-2026-2.csv',
    ]);
    const split = m.settings_accountant_export_yayoi_split({ count: 2 });
    await waitFor(() => (c.textContent ?? '').includes(split));
  });

  test('仕訳が無い年度は保存せず、仕訳が無いことを知らせる', async () => {
    const c = await mountSettings();

    clickYayoi(c);
    const empty = m.settings_accountant_export_yayoi_empty({ year: 2026 });
    await waitFor(() => (c.textContent ?? '').includes(empty));
    expect(saveFile).not.toHaveBeenCalled();
  });

  test('明細が 21 行の仕訳は日付と摘要を示し、摘要は HTML として解釈しない', async () => {
    const description = '<img src=x onerror=alert(1)>';
    await seedWideEntry(description);
    const c = await mountSettings();

    clickYayoi(c);
    await waitFor(() => c.querySelector('[data-testid="yayoi-export-notices"]') !== null);
    const notices = c.querySelector('[data-testid="yayoi-export-notices"]')!;
    expect(notices.textContent).toContain(m.settings_accountant_export_yayoi_notice_intro());
    expect(notices.textContent).toContain('2026-04-15');
    expect(notices.textContent).toContain(description);
    expect(notices.textContent).toContain(
      m.settings_accountant_export_yayoi_reason_rows({ rows: 21 }),
    );
    expect(c.querySelector('img')).toBeNull();
  });
});
